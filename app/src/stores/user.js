// 用户登录态（token/user 持久化在 localStorage，键与 legacy 一致）
import { defineStore } from 'pinia'
import {
  getToken, getStoredUser, setToken, setStoredUser, clearStoredAuth,
  apiLogin, apiRegister
} from '../services/api'

export const useUserStore = defineStore('user', {
  state: () => ({
    token: getToken() || null,
    user: getStoredUser(),
    isOnline: !!(getToken() && getStoredUser())
  }),
  getters: {
    userId: (s) => (s.user && s.user.id) || null,
    shortName: (s) => {
      if (!s.user) return ''
      return (s.user.displayName || s.user.username || '?').substring(0, 1).toUpperCase()
    }
  },
  actions: {
    applyAuth({ token, user }) {
      this.token = token
      this.user = user
      this.isOnline = true
      setToken(token)
      setStoredUser(user)
    },
    async login(username, password) {
      const data = await apiLogin(username, password)
      this.applyAuth(data)
      return data
    },
    async register(username, displayName, password) {
      const data = await apiRegister(username, displayName, password)
      this.applyAuth(data)
      return data
    },
    logout() {
      this.token = null
      this.user = null
      this.isOnline = false
      clearStoredAuth()
    },
    enterOfflineMode() {
      this.logout()
    },
    isAdmin() {
      return !!(this.user && this.user.role === 'admin')
    }
  }
})

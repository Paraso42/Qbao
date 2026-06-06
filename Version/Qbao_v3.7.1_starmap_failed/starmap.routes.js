const { pool } = require('../db');
const { requireAuth } = require('../middleware');
const crypto = require('crypto');

/**
 * GET /api/v1/starmap/:subjectId
 * Returns precomputed star map data for the given subject.
 * Supports ETag conditional requests via If-None-Match header.
 *
 * Query params:
 *   ?snapshots_only=1  — return only the snapshots array (lightweight)
 */
module.exports = function (app) {
  app.get('/api/v1/starmap/:subjectId', requireAuth, async (req, res) => {
    try {
      const { subjectId } = req.params;
      const snapshotsOnly = req.query.snapshots_only === '1';

      // 1. Load user state from DB
      const r = await pool.query(
        'SELECT state_json FROM user_data WHERE user_id = $1',
        [req.userId]
      );
      if (r.rows.length === 0) {
        return res.json(emptyResponse());
      }

      const state = r.rows[0].state_json;
      const subject = state.subjects && state.subjects[subjectId];
      if (!subject) {
        return res.status(404).json({ error: '科目不存在' });
      }

      // 2. Compute ETag from state hash (skip if lightweight request)
      if (!snapshotsOnly) {
        const etag = hashState(state, subjectId);
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) {
          return res.status(304).end();
        }
      }

      // 3. Collect data
      const chapters = [];
      const tagsMap = new Map();
      const questionsList = [];
      const chapterIds = subject.chapterIds || [];
      let qIdCounter = 0;

      // First pass: compute per-question last review time from history
      const questionReviewMap = new Map(); // key: `${chapterId}::${tag}::${questionTextHash}` → lastReviewTime
      const allHistory = (state.history || []).filter(h =>
        chapterIds.includes(h.chapterId)
      );
      const sortedByDate = [...allHistory].sort(
        (a, b) => new Date(a.date || 0) - new Date(b.date || 0)
      );
      for (const h of sortedByDate) {
        if (!h.questions) continue;
        const hDate = new Date(h.date || 0).getTime();
        for (const q of h.questions) {
          if (!q.tag) continue;
          const qText = (q.question || '').substring(0, 50).toLowerCase();
          const key = `${h.chapterId}::${q.tag}::${qText}`;
          questionReviewMap.set(key, hDate);
        }
      }

      for (const cid of chapterIds) {
        const ch = state.chapters && state.chapters[cid];
        if (!ch) continue;

        let chTotalQ = 0;
        let chCorrect = 0;

        // Count from quizSets if available, else from questions array
        const allQ = (ch.quizSets && ch.quizSets.length > 0)
          ? ch.quizSets.flatMap(qs => qs.questions || [])
          : (ch.questions || []);

        chTotalQ = allQ.length;

        // Determine correctness from quizSets or direct userAnswers
        const tagStats = ch.strategy && ch.strategy.tagMeta ? ch.strategy.tagMeta : {};

        for (const tagName in tagStats) {
          const ts = tagStats[tagName] || {};
          const existing = tagsMap.get(tagName);
          if (existing) {
            existing.totalQ += ts.totalQ || 0;
            existing.correct += ts.correct || 0;
            existing.wrongCount += ts.wrong || 0;
          } else {
            tagsMap.set(tagName, {
              id: tagName,
              label: tagName,
              chapterId: cid,
              totalQ: ts.totalQ || 0,
              correct: ts.correct || 0,
              accuracy: ts.totalQ > 0 ? (ts.correct || 0) / ts.totalQ : 0,
              category: (ts.totalQ > 0 && (ts.correct || 0) / ts.totalQ < 0.5) ? 'error'
                : (ts.totalQ > 0 ? 'review' : 'new'),
              lastAnswer: ts.lastAnswer || 0,
              questionCount: ts.totalQ || 0,
              wrongCount: ts.wrong || 0,
            });
          }
        }

        // Collect valid tag names from current strategy (tagMeta)
        const validTagNames = new Set();
        for (const key of tagsMap.keys()) {
          validTagNames.add(key);
        }

        // Build question list from history — only include tags still in strategy
        const chHistory = (state.history || []).filter(h => h.chapterId === cid);

        for (const h of chHistory) {
          if (!h.questions) continue;
          for (const q of h.questions) {
            if (!q.tag) continue;
            const tagName = q.tag;
            // Skip tags that have been deleted from current strategy
            if (!validTagNames.has(tagName)) continue;
            const qText = (q.question || '').substring(0, 50).toLowerCase();
            const reviewKey = `${cid}::${tagName}::${qText}`;
            questionsList.push({
              id: qIdCounter++,
              tagId: tagName,
              chapterId: cid,
              type: q.type || 'single',
              question: (q.question || '').substring(0, 80),
              isCorrect: q.isCorrect === true,
              isWrong: q.isCorrect === false,
              lastReviewTime: questionReviewMap.get(reviewKey) || 0,
            });
            if (q.isCorrect === true) chCorrect++;
          }
        }

        chapters.push({
          id: cid,
          name: ch.name || cid,
          totalQ: chTotalQ,
          correct: chCorrect,
          accuracy: chTotalQ > 0 ? chCorrect / chTotalQ : 0,
        });
      }

      // 4. Compute co-occurrence edges from history
      const coOccurrence = new Map();

      for (const h of allHistory) {
        if (!h.questions || h.questions.length < 2) continue;
        const tagsInRound = new Set();
        for (const q of h.questions) {
          if (q.tag) tagsInRound.add(q.tag);
        }
        const tagArr = Array.from(tagsInRound);
        for (let i = 0; i < tagArr.length; i++) {
          for (let j = i + 1; j < tagArr.length; j++) {
            const key = tagArr[i] < tagArr[j]
              ? `${tagArr[i]}|||${tagArr[j]}`
              : `${tagArr[j]}|||${tagArr[i]}`;
            coOccurrence.set(key, (coOccurrence.get(key) || 0) + 1);
          }
        }
      }

      const maxCooc = Math.max(1, ...coOccurrence.values());
      const edges = [];
      for (const [key, count] of coOccurrence) {
        const weight = count / maxCooc;
        if (weight > 0.15) {
          const [source, target] = key.split('|||');
          edges.push({ source, target, weight: Math.round(weight * 100) / 100 });
        }
      }

      // 5. Compute similarity matrices per tag (bigram Jaccard, only for tags with >3 questions)
      const similarityMatrix = {};
      for (const [tagName] of tagsMap) {
        const tagQs = questionsList.filter(q => q.tagId === tagName);
        if (tagQs.length <= 3) continue;
        const matrix = buildSimilarityMatrix(tagQs);
        similarityMatrix[tagName] = matrix;
      }

      // 6. Build snapshots (reuse sortedByDate from question review pass)
      const snapshots = [];
      const cumulativeTagStats = {};

      for (let i = 0; i < sortedByDate.length; i++) {
        const h = sortedByDate[i];
        if (!h.questions) continue;

        for (const q of h.questions) {
          if (!q.tag) continue;
          if (!cumulativeTagStats[q.tag]) {
            cumulativeTagStats[q.tag] = { totalQ: 0, correct: 0 };
          }
          cumulativeTagStats[q.tag].totalQ++;
          if (q.isCorrect) cumulativeTagStats[q.tag].correct++;
        }

        snapshots.push({
          index: i,
          date: h.date || '',
          tagStats: JSON.parse(JSON.stringify(cumulativeTagStats)),
        });
      }

      if (snapshotsOnly) {
        return res.json({ snapshots });
      }

      const tags = Array.from(tagsMap.values());
      const nodeCount = chapters.length + tags.length;
      const questionCount = questionsList.length;

      res.json({
        subjectName: subject.name || '',
        chapters,
        tags,
        questions: questionsList,
        edges,
        similarityMatrix,
        snapshots,
        nodeCount,
        questionCount,
      });
    } catch (e) {
      console.error('starmap error:', e);
      res.status(500).json({ error: e.message });
    }
  });
};

function emptyResponse() {
  return {
    subjectName: '',
    chapters: [],
    tags: [],
    questions: [],
    edges: [],
    similarityMatrix: {},
    snapshots: [],
    nodeCount: 0,
    questionCount: 0,
  };
}

function hashState(state, subjectId) {
  const str = JSON.stringify({
    subj: state.subjects && state.subjects[subjectId],
    history: (state.history || []).filter(h => {
      const subj = state.subjects && state.subjects[subjectId];
      return subj && subj.chapterIds && subj.chapterIds.includes(h.chapterId);
    }),
    srs: state.srsData || {},
  });
  return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
}

/**
 * Build bigram Jaccard similarity matrix for questions within the same tag.
 * Returns an NxN matrix where matrix[i][j] = similarity between question i and j.
 */
function buildSimilarityMatrix(questions) {
  const n = questions.length;
  const matrix = Array.from({ length: n }, () => new Array(n).fill(0));

  // Precompute bigram sets for each question
  const bigramSets = questions.map(q => {
    const text = (q.question || '').toLowerCase();
    const bigrams = new Set();
    for (let i = 0; i < text.length - 1; i++) {
      bigrams.add(text.substring(i, i + 2));
    }
    return bigrams;
  });

  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = jaccardSimilarity(bigramSets[i], bigramSets[j]);
      matrix[i][j] = Math.round(sim * 100) / 100;
      matrix[j][i] = matrix[i][j];
    }
  }

  return matrix;
}

function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

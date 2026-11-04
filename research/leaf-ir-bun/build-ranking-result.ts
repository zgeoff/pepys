import { buildCosine } from './build-cosine.ts';

export interface RankedEmail {
  emailID: string;
  score: number;
}

export interface QueryRanking {
  query: string;
  targetID: string;
  targetRank: number;
  top: RankedEmail[];
}

export interface RankingResult {
  rankings: QueryRanking[];
  hitsAt1: number;
  hitsAt5: number;
}

export interface RankingInput {
  queries: { text: string; targetID: string; vector: number[] }[];
  emails: { id: string; vector: number[] }[];
  topCount: number;
}

export function buildRankingResult(input: RankingInput): RankingResult {
  const rankings = input.queries.map((query) => {
    const ranked = input.emails
      .map((email) => ({ emailID: email.id, score: buildCosine(query.vector, email.vector) }))
      .toSorted((left, right) => right.score - left.score);

    return {
      query: query.text,
      targetID: query.targetID,
      targetRank: ranked.findIndex((entry) => entry.emailID === query.targetID) + 1,
      top: ranked.slice(0, input.topCount),
    };
  });

  return {
    rankings,
    hitsAt1: rankings.filter((ranking) => ranking.targetRank === 1).length,
    hitsAt5: rankings.filter((ranking) => ranking.targetRank >= 1 && ranking.targetRank <= 5)
      .length,
  };
}

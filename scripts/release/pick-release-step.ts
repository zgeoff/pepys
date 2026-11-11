export interface Release {
  id: number;
  tagName: string;
  isDraft: boolean;
}

export interface ReleaseStep {
  // drafts of the tag that a run cut off left behind; no deploy can download a draft
  staleDraftIDs: readonly number[];

  // a published release is never changed, only checked
  hasPublished: boolean;
}

// Picks what a run of the host job does with the releases that already exist for its tag.
export function pickReleaseStep(releases: readonly Release[], tag: string): ReleaseStep {
  const ofTag = releases.filter((release) => release.tagName === tag);

  return {
    staleDraftIDs: ofTag.filter((release) => release.isDraft).map((release) => release.id),
    hasPublished: ofTag.some((release) => !release.isDraft),
  };
}

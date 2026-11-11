import { expect, test } from 'bun:test';
import { pickReleaseStep } from './pick-release-step.ts';

test.each([
  {
    title: 'creates a release when the tag has none',
    releases: [{ id: 1, tagName: 'v0.9.0', isDraft: false }],
    step: { staleDraftIDs: [], hasPublished: false },
  },
  {
    title: 'removes each draft of the tag, then creates a release',
    releases: [
      { id: 4, tagName: 'v1.0.0', isDraft: true },
      { id: 5, tagName: 'v1.0.0', isDraft: true },
      { id: 6, tagName: 'v0.9.0', isDraft: true },
    ],
    step: { staleDraftIDs: [4, 5], hasPublished: false },
  },
  {
    title: 'checks the published release of the tag',
    releases: [{ id: 7, tagName: 'v1.0.0', isDraft: false }],
    step: { staleDraftIDs: [], hasPublished: true },
  },
  {
    title: 'removes a draft beside the published release of the tag',
    releases: [
      { id: 7, tagName: 'v1.0.0', isDraft: false },
      { id: 8, tagName: 'v1.0.0', isDraft: true },
    ],
    step: { staleDraftIDs: [8], hasPublished: true },
  },
])('it $title', (row) => {
  expect(pickReleaseStep(row.releases, 'v1.0.0')).toStrictEqual(row.step);
});

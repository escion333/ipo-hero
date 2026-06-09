// Mock forum fixtures for building and previewing the community UI without a
// live Supabase backend. These conform to the domain types in
// src/lib/community/types.ts, so components built against them swap straight onto
// the real CommunityClient data with no shape changes.
//
// SpaceX-flavored but illustrative. Timestamps are relative to a fixed anchor so
// the preview is deterministic; `relativeTime` renders them against the real now.
import type { CommunityUser, Post, Thread } from "../../lib/community/types";

const ACCESSION = "0001628280-26-036936";

// Anchor "now" the fixtures are authored against (2026-06-08T12:00:00Z).
const T0 = Date.UTC(2026, 5, 8, 12, 0, 0);
const ago = (mins: number) => new Date(T0 - mins * 60_000).toISOString();

export const mockUsers: Record<string, CommunityUser> = {
  nova: {
    id: "u-nova",
    handle: "nova_reads10ks",
    displayName: "Nova",
    avatarUrl: null,
    role: "moderator",
  },
  delta: {
    id: "u-delta",
    handle: "delta_v_investing",
    displayName: "Delta-V",
    avatarUrl: null,
    role: "member",
  },
  rhea: {
    id: "u-rhea",
    handle: "rhea_on_orbit",
    displayName: "Rhea",
    avatarUrl: null,
    role: "member",
  },
  kepler: {
    id: "u-kepler",
    handle: "kepler_capital",
    displayName: "Kepler Capital",
    avatarUrl: null,
    role: "member",
  },
};

/** The signed-in user the preview pretends to be (use for write-path states). */
export const mockCurrentUser: CommunityUser = mockUsers.delta;

export const mockThreads: Thread[] = [
  {
    id: "t-control",
    filingAccession: ACCESSION,
    sectionId: "governance",
    title: "Dual-class structure: how much should the founder's voting control discount the multiple?",
    body: "The summary says the founder keeps majority voting power post-IPO via high-vote Class B. Curious how people are thinking about a governance discount here vs. other founder-controlled listings.",
    author: mockUsers.kepler,
    score: 47,
    replyCount: 12,
    isLocked: false,
    createdAt: ago(60 * 9),
    updatedAt: ago(34),
  },
  {
    id: "t-proceeds",
    filingAccession: ACCESSION,
    sectionId: "offering",
    title: "\"General corporate purposes\" use-of-proceeds — vague or normal for this stage?",
    body: "No specific allocation between Starship and Starlink. Is the lack of a breakdown a red flag or just standard boilerplate for a company this size?",
    author: mockUsers.rhea,
    score: 21,
    replyCount: 6,
    isLocked: false,
    createdAt: ago(60 * 26),
    updatedAt: ago(60 * 3),
  },
  {
    id: "t-launch-risk",
    filingAccession: ACCESSION,
    sectionId: "risks",
    title: "Launch-reliability risk is doing a lot of work in this filing",
    body: "The launch-failure language reads as genuinely company-specific, not boilerplate. Reliability ties to both revenue and the manifest. How are you weighting it?",
    author: mockUsers.nova,
    score: 33,
    replyCount: 9,
    isLocked: false,
    createdAt: ago(60 * 18),
    updatedAt: ago(60 * 2),
  },
  {
    id: "t-meta",
    filingAccession: ACCESSION,
    sectionId: null,
    title: "Welcome — what this forum is (and isn't)",
    body: "General discussion of the SpaceX S-1. Opinions are your own; IPO Hero stays the neutral, sourced substrate. Keep debate close to the filing text where you can.",
    author: mockUsers.nova,
    score: 58,
    replyCount: 3,
    isLocked: true,
    createdAt: ago(60 * 72),
    updatedAt: ago(60 * 40),
  },
];

// Posts for the "t-control" thread, including one nested reply (parentPostId).
export const mockPosts: Record<string, Post[]> = {
  "t-control": [
    {
      id: "p-1",
      threadId: "t-control",
      parentPostId: null,
      body: "Founder control isn't automatically a discount — it depends on alignment. Here the operator IS the founder, so the usual agency argument is weaker than a typical dual-class SaaS listing.",
      author: mockUsers.delta,
      score: 18,
      createdAt: ago(60 * 8),
      updatedAt: ago(60 * 8),
    },
    {
      id: "p-2",
      threadId: "t-control",
      parentPostId: "p-1",
      body: "Agreed on alignment, but \"weaker agency argument\" still isn't zero — public holders have limited say if priorities shift. I'd want to see the sunset terms before pricing it in either direction.",
      author: mockUsers.rhea,
      score: 9,
      createdAt: ago(60 * 6),
      updatedAt: ago(60 * 6),
    },
    {
      id: "p-3",
      threadId: "t-control",
      parentPostId: null,
      body: "The filing doesn't disclose terms yet, so any specific discount number is guesswork right now. Worth anchoring this thread to the Prospectus Summary section so people read the actual language.",
      author: mockUsers.nova,
      score: 14,
      createdAt: ago(34),
      updatedAt: ago(34),
    },
  ],
};


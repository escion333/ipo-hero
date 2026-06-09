// Presentational forum components. These are pure: props + callbacks only, no data
// fetching, routing, or supabase. The wiring layer (auth context, CommunityClient,
// router) feeds them domain records from src/lib/community/types.ts.

export { VoteControl } from "./vote-control";
export { UserChip, Avatar } from "./user-chip";
export { SectionAnchor } from "./section-anchor";
export { ForumDisclaimer } from "./forum-disclaimer";
export { SignInPrompt } from "./sign-in-prompt";
export { AccountMenu } from "./account-menu";

export { ThreadCard } from "./thread-card";
export type { ThreadCardProps } from "./thread-card";
export { ThreadList } from "./thread-list";
export type { ThreadListProps } from "./thread-list";
export { PostItem, buildPostTree } from "./post-item";
export type { PostNode, PostItemProps } from "./post-item";
export { ThreadView } from "./thread-view";
export type { ThreadViewProps } from "./thread-view";

export { NewThreadForm } from "./new-thread-form";
export type { NewThreadFormProps } from "./new-thread-form";
export { ReplyForm } from "./reply-form";
export type { ReplyFormProps } from "./reply-form";

export { BriefForumShell } from "./brief-forum-shell";
export type { BriefForumShellProps, BriefForumApi } from "./brief-forum-shell";

export { relativeTime, compactCount } from "./format";

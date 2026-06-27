# DreamScape MongoDB Collection & Schema Usage Audit Report

## 1. Executive Summary

This report presents a full read-only audit of the MongoDB database usage within the DreamScape application. A total of **20 collections** were scanned, and the codebase was audited for model schemas, read paths, and write paths. 

The application architecture cleanly separates:
1. **Core User Actions:** Auth, sessions, profiles, daily activity, social graphs, and dream posts (`users`, `dreams`, `comments`, `otps`).
2. **Personalized Analysis Context (Component B):** Psychological traits, cultural elements, zodiacs, and scoring scales (`user_dream_profiles`).
3. **Academic/Knowledge Library (Component D RAG):** Contributed documents, processed full-texts, vector text chunks, candidate drafts, validated rules, and mapping nodes (`source_contributions`, `academic_sources`, `academic_fulltexts`, `academic_fulltext_sections`, `academic_chunks`, `knowledge_rules`, `knowledge_rule_candidates`, `knowledge_rule_sources`).
4. **Social Interactions:** Direct messages and in-app action notifications (`conversations`, `messages`, `notifications`).

### Key Audit Findings:
- **Orphan Comment Leakage:** The audit identified **14 comments pointing to non-existent dreams** (100% of comments in the database). The root cause is the lack of a cascade deletion mechanism in the `deleteDream` controller. When a dream is deleted, its comments remain in the database indefinitely.
- **Redundant Fields in `dreams`:** Fields like `aiAnalysis`, `visibility`, and `dreamText` are redundant or unused. `aiAnalysis` is explicitly set to `undefined` before saving (as the LLM result lives in `ai_result`), `visibility` duplicates `privacy`, and `dreamText` duplicates `content`.
- **Legacy Duplicate Collection:** The collection `knowledgerulecandidates` (count: 0) is a legacy byproduct of Mongoose's default pluralization naming before the schema explicitly specified `collection: 'knowledge_rule_candidates'`. It can be safely dropped.
- **`user_dream_profiles` Vitality:** Deleting all documents from `user_dream_profiles` does not crash the app due to robust defaults, but it does erase users' psychological context (Big Five, Chronotypes) and pauses cultural grounding during dream analysis until profiles are re-saved. It is NOT obsolete and is actively recreated during user registration (`verifyOtp`) or profile updates (`updateProfile`).

---

## 2. Collection-by-Collection Analysis & Field Tables

---

### Collection: `users`
- **Model File:** [User.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/User.ts)
- **Purpose:** Core user credentials, social settings, streak indicators, achievements tracker, and active device sessions.
- **Used by visible feature:** Registration, Login, Profile Page, Followers/Following, Streaks, Rank Titles, Active Sessions, and Privacy settings.
- **Can be empty:** No (requires at least the authenticated user to operate).
- **Safe to delete collection:** No.
- **Safe to delete documents:** No.
- **Safe to delete fields:** Birth profile fields (`birth_date`, `birth_hour`, `fullName`, `gender`) are duplicate data mirrored in `user_dream_profiles.basicProfile`, but removing them requires minor controller adjustments.
- **Recommendation:** Keep collection. Deprecate duplicate birth profile fields in a future phase.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `username` | String | Registration (`verifyOtp`), Profile Update | authController, userController | Yes (e.g. `@helloduongnha`) | No (Required) | Keep | Unique handle for user identity. Breaks routing. |
| `display_name` | String | Registration, Profile Update | authController, userController | Yes | No (Required) | Keep | User display name. Breaks templates. |
| `email` | String | Registration, Profile Update | authController, userController | No (Private) | No (Required) | Keep | Unique login credential. Breaks authentication. |
| `password` | String | Registration, Profile Update | authController (comparisons) | No | No (Required) | Keep | Encrypted credential. Breaks login. |
| `avatar` | String | Registration, Profile Update | authController, userController | Yes | Yes | Keep | Profile picture URL. Falls back to initials. |
| `bio` | String | Registration, Profile Update | authController, userController | Yes | Yes | Keep | User biography text. |
| `follower_count`| Number | followUser, unfollowUser | userController | Yes | Yes (default 0) | Keep | Denormalized count. |
| `followers` | Array[Id] | followUser, unfollowUser | userController, rankEngine | Yes | Yes (default `[]`) | Keep | Followers list. Breaks follow graphs. |
| `following` | Array[Id] | followUser, unfollowUser | userController, rankEngine | Yes | Yes (default `[]`) | Keep | Following list. Breaks follow graphs. |
| `isPrivateAccount`| Boolean| Profile Update | authController, feed/profile | Yes | No (default `false`)| Keep | Drives account privacy flags. |
| `dmPrivacy` | String | Profile Update | authController, chatController | Yes | No (default `everyone`)| Keep | Limits incoming DMs. |
| `defaultPrivacy`| String | Profile Update | authController, Home composer | Yes | No (default `public`)| Keep | Default visibility selection for composer. |
| `followersPrivacy`| String| Profile Update | authController, social | Yes | No (default `everyone`)| Keep | Privacy controls for followers list. |
| `followingPrivacy`| String| Profile Update | authController, social | Yes | No (default `everyone`)| Keep | Privacy controls for following list. |
| `lastLoginDate` | Date | streakMiddleware | streakMiddleware | No | Yes | Keep | Tracks streak dates. |
| `loginHistory` | Array[String]| streakMiddleware | streakMiddleware, achievements | Yes (Grid) | Yes (default `[]`) | Keep | Renders login calendar activity squares. |
| `streakCount` | Number | streakMiddleware | streakMiddleware, rankEngine | Yes | No (default 0) | Keep | Current consecutive login days. |
| `highestStreak` | Number | streakMiddleware | streakMiddleware, rankEngine | Yes | No (default 0) | Keep | Highest streak. Unlocks milestones. |
| `rankPoints` | Number | streakMiddleware, like/comment | streakMiddleware, rankEngine | Yes | No (default 0) | Keep | Cumulative rank points. Calculates title. |
| `currentRank` | String | streakMiddleware, like/comment | streakMiddleware, profile | Yes | No (default 'Nhà Mơ Mộng Mới')| Keep | Displays user's rank badge in UI. |
| `dailyTasks` | Object | dreamController, like/comment | userController, daily check | Yes | No (default unchecked)| Keep | Tracks three daily tasks. Resets daily. |
| `achievements` | Array[String]| rankEngine, contributionStats | userController, rankEngine | Yes | Yes (default `[]`) | Keep | Mirrored list of all activity + contribution keys. |
| `timeOnlineToday`| Number | heartbeats / updates | userController, achievements | Yes | No (default 0) | Keep | Active minutes today (resets at midnight). |
| `totalTimeOnline`| Number | heartbeats / updates | userController, achievements | Yes | No (default 0) | Keep | Cumulative active minutes. |
| `lastActiveDate`| String | heartbeats | streakMiddleware | No | Yes | Keep | Tracks daily reset timestamps. |
| `lastHeartbeatAt`| Date | heartbeats | userController | No | Yes | Keep | Real-time presence checking. |
| `birth_date` | String | Profile Update | authController, analyzeService | Yes | Yes | Remove | Duplicated in `user_dream_profiles`. Migrate query. |
| `birth_hour` | String | Profile Update | authController, analyzeService | Yes | Yes | Remove | Duplicated in `user_dream_profiles`. Migrate query. |
| `fullName` | String | Profile Update | authController, analyzeService | Yes | Yes | Remove | Duplicated in `user_dream_profiles`. Migrate query. |
| `gender` | String | Profile Update | authController, analyzeService | Yes | Yes | Remove | Duplicated in `user_dream_profiles`. Migrate query. |
| `sessions` | Array[Obj]| login, verifyOtp, logout | authMiddleware, authController | Yes | Yes (default `[]`) | Keep | Tracks active browser sessions and IPs. |

---

### Collection: `dreams`
- **Model File:** [Dream.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/Dream.ts)
- **Purpose:** Stores user dream narratives, sleep environments, likes lists, comment counters, and generated AI Oracle analysis payloads.
- **Used by visible feature:** Home Feed, Profile Feed, Post Detail Modal, Oracle Analysis Results Page.
- **Can be empty:** Yes (new databases start empty).
- **Safe to delete collection:** No.
- **Safe to delete documents:** No (loses user history).
- **Safe to delete fields:** `aiAnalysis`, `visibility`, and `dreamText` are redundant.
- **Recommendation:** Keep collection, clean up redundant fields later.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `userId` | ObjectId | createDream, analyzeDream | feed/timeline controllers | Yes | No (Required) | Keep | Owner ID. Link to User profile details. |
| `content` | String | createDream, analyzeDream, edit | feed controllers, frontend UI | Yes | No (Required) | Keep | The main narrative text written by the user. |
| `mood_tag` | String | createDream, analyzeDream | feed, cards, modals | Yes | Yes (default '') | Keep | Visual category tags (e.g. Lucid, Nightmare). |
| `is_public` | Boolean | createDream, analyzeDream, privacy| feed, query selectors | Yes | No (default `true`) | Keep | Fast boolean check for global feed filtering. |
| `privacy` | String | createDream, analyzeDream, privacy| feed/timeline queries | Yes | No (default `public`) | Keep | Privacy state ('public', 'private'). |
| `likes` | Array[Str] | toggleLike | toggleLike, card checks | Yes (state) | Yes (default `[]`) | Keep | User ID list for O(1) membership check. |
| `likes_count` | Number | toggleLike | feed, cards, modals | Yes | No (default 0) | Keep | Denormalized count for performance. |
| `comments_count`| Number | addComment | feed, cards, modals | Yes | No (default 0) | Keep | Denormalized count. |
| `created_at` | Date | createDream, analyzeDream | timelines, cursor pagination| Yes | No (Required) | Keep | Pagination index. Breaks cursor feed loading. |
| `ai_status` | String | createDream, analyzeDream, worker | feed, loading indicators | Yes | No (default `pending`)| Keep | Tracks Oracle pipeline ('pending', 'sensing', etc). |
| `ai_result` | Object | analyzeDream, worker | oracle results rendering | Yes | Yes (default `null`) | Keep | AI interpretation payload (JSON). |
| `edit_history` | Array[Obj] | updateDream | cards, modals (Edited badge) | Yes | Yes (default `[]`) | Keep | Versions before edit. Triggers "Edited" badge. |
| `dreamText` | String | analyzeDream | None (written but not read) | No | Yes | Remove | Redundant with `content`. |
| `sleepContext` | Object | analyzeDream | worker, analysis detail | Yes | Yes (default `{}`) | Keep | Sleep context (position, temperature, late meal). |
| `visibility` | String | analyzeDream | None (written but not read) | No | Yes | Remove | Redundant with `privacy` ('public'/'private'). |
| `aiAnalysis` | Object | None (explicitly deleted) | None | No | Yes | Remove | Unused schema field. Explicitly deleted in code. |
| `retrievedContext`| Object| analyzeDream, worker | audit trails / RAG check | Yes (Audit) | Yes (default `null`) | Keep | Stores RAG symbols and matching rules for audit. |
| `analysisMetadata`| Object| analyzeDream, worker | audit info (models, temperatures) | Yes (Audit) | Yes (default `{}`) | Keep | Records model versions and settings used. |

---

### Collection: `comments`
- **Model File:** [Comment.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/Comment.ts)
- **Purpose:** Stores user feedback/discussions on dream posts.
- **Used by visible feature:** Comment thread inside Post Detail Modal, "Replies" tab on User profile page.
- **Can be empty:** Yes.
- **Safe to delete collection:** No.
- **Safe to delete documents:** Only comments whose parent `dreamId` no longer exists in `dreams` (orphans).
- **Recommendation:** Keep comments. Fix cascade deletion in `deleteDream` to avoid orphans.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `dreamId` | ObjectId | addComment | getComments, getUserComments | Yes | No (Required) | Keep | Ref to Dream. Breaks details loading if removed. |
| `userId` | ObjectId | addComment | getComments, getUserComments | Yes | No (Required) | Keep | Ref to commenter. Populates name/avatar. |
| `content` | String | addComment | getComments, getUserComments | Yes | No (Required) | Keep | Comment text. |
| `created_at` | Date | addComment | getComments, getUserComments | Yes | No (Required) | Keep | Sorts comments chronologically. |

---

### Collection: `user_dream_profiles`
- **Model File:** None (Manipulated via dynamic collections queries in [authController.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/controllers/authController.ts) and [analyze.service.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/services/analyze.service.ts)).
- **Purpose:** Stores psychological indicators (Big Five, Chronotypes, Schemas), birth metrics, zodiac properties, and scoring matrices used to personalize Oracle analysis (Component B).
- **Used by visible feature:** Personalized Oracle dream interpretations, cultural analysis, and scoring.
- **Can be empty:** Yes (Robust fallbacks are configured).
- **Safe to delete collection:** No.
- **Safe to delete documents:** Yes, but triggers loss of personalized data.
- **Recommendation:** Keep. Define a formal Mongoose model schema (`UserDreamProfile.ts`) for safety instead of raw inline queries.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `userId` | ObjectId | verifyOtp, updateProfile | runDreamAnalysis | Yes (indirectly) | No | Keep | Connects profile variables to the User. |
| `basicProfile` | Object | verifyOtp, updateProfile | runDreamAnalysis | Yes | Yes (defaults exist)| Keep | Standard gender/name/birth markers. |
| `culturalProfile`| Object | verifyOtp, updateProfile | runDreamAnalysis | Yes (Cultural) | Yes (defaults exist)| Keep | Derived zodiac, element, life path tags. |
| `scoringProfile` | Object | verifyOtp, updateProfile | runDreamAnalysis | Yes (Scoring) | Yes (lazy backfill) | Keep | Numeric weights impacting dream valence scoring. |
| `measuredPsychologicalProfile`| Object| updateProfile, default inserts| runDreamAnalysis | Yes (Psych) | Yes (defaults exist)| Keep | Stores Big Five percentages and sleep chronotypes. |
| `learnedPersonalPattern`| Object| default inserts | runDreamAnalysis | Yes (Symbols) | Yes (defaults exist)| Keep | Derived statistics of frequent symbols. |
| `preferences` | Object | default inserts | runDreamAnalysis | Yes | Yes (defaults exist)| Keep | Privacy permissions for personal stats. |

---

### Collection: `user_contribution_stats`
- **Model File:** [UserContributionStats.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/UserContributionStats.ts)
- **Purpose:** Tracks denormalized metrics on academic source contributions for active users.
- **Used by visible feature:** Library contribution levels, approved/pending milestones, and progress bar on User Profile.
- **Can be empty:** Yes.
- **Safe to delete collection:** No (breaks profile dashboard UI).
- **Safe to delete documents:** Yes, can be recalculated.
- **Recommendation:** Keep.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `userId` | ObjectId | incrementSubmitted, recordApproval| userController | Yes | No (Required) | Keep | Links stats to owner. |
| `submittedSourceCount`| Number | incrementSubmitted | userController | Yes | No (default 0) | Keep | Total source documents submitted. |
| `approvedSourceCount` | Number | recordApproval | userController, level checks| Yes | No (default 0) | Keep | Total accepted sources. Drives contribution rank. |
| `rejectedSourceCount` | Number | recordRejection | userController | Yes | No (default 0) | Keep | Total rejected submissions. |
| `pendingSourceCount` | Number | incrementSubmitted, recordApproval| userController | Yes | No (default 0) | Keep | Submissions awaiting review. |
| `contributionPoints` | Number | recordApproval | userController | Yes | No (default 0) | Keep | Calculated points from accepted papers. |
| `contributionLevel` | Number | checkAndAwardLevelAchievements | userController | Yes | No (default 0) | Keep | Level rank (1 to 6). |
| `lastContributionAt` | Date | incrementSubmitted | userController | Yes | Yes | Keep | Time of last submission. |

---

### Collection: `user_achievements`
- **Model File:** [UserAchievement.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/UserAchievement.ts)
- **Purpose:** Official ledger of unlocked library contribution-related achievements.
- **Used by visible feature:** Unlocked badges grid on the User profile page.
- **Can be empty:** Yes.
- **Safe to delete collection:** No.
- **Safe to delete documents:** No.
- **Recommendation:** Keep.

#### Fields Table
| Field Name | Type | Written By | Read By | Visible in UI | Can be Null/Empty | Keep / Remove | Reason & Impact |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `userId` | ObjectId | checkAndAwardLevelAchievements | userController | Yes | No (Required) | Keep | Link to recipient user. |
| `achievementKey`| String | checkAndAwardLevelAchievements | userController, duplicate check| Yes | No (Required) | Keep | Identifier string (e.g. `contrib_level_1`). |
| `achievementName`| String | checkAndAwardLevelAchievements | userController | Yes | No (Required) | Keep | Display title of badge. |
| `level` | Number | checkAndAwardLevelAchievements | userController | Yes | No (Required) | Keep | Tier level (1 to 6). |
| `unlockedAt` | Date | checkAndAwardLevelAchievements | userController | Yes | No (default Now) | Keep | Timestamp of unlock. |
| `source` | String | checkAndAwardLevelAchievements | userController | No | No (Required) | Keep | Domain value (enum: `'source_contribution'`). |

---

### Collections: `knowledge_rules`, `knowledge_rule_candidates`, `knowledge_rule_sources`, `academic_sources`, `academic_fulltexts`, `academic_fulltext_sections`, `academic_chunks`
- **Purpose:** Comprise the academic knowledge grounding RAG system (Component D).
- **Visible Features:** Moderation candidates panel, rule catalog, document library details, and Oracle citation cards.
- **Safe to delete collections:** No.
- **Safe to delete documents:** Candidate records and processed chunk files can be cleared or re-extracted. Live rules and parent sources cannot be deleted without breaking matching/citations.
- **Recommendation:** Keep. Drop the duplicate, empty, auto-created legacy database collection `knowledgerulecandidates`.

---

### Collections: `conversations`, `messages`, `notifications`, `otps`
- **Purpose:** In-app communications, activity logging, and authentication security.
- **Visible Features:** Direct chats, message lists, header notifications alerts, and verification emails.
- **Recommendation:** Keep.

---

## 3. Special User-Domain Audit Answers

### A. `users.achievements` vs `user_achievements`
- **Are both used?** Yes. `users.achievements` is a flat string array on the User document that tracks **all** unlocked milestone keys (including likes, comments, post counts, streak days, and online hours). `user_achievements` is a standalone collection that stores **only** contribution achievements (level 1-6) with unlock details (`unlockedAt`, `source`).
- **Is `users.achievements` a mirror/cache?** Yes, for contribution-based achievements (e.g. `contrib_level_1`), the user document array mirrors the keys from the `user_achievements` collection. For activity/social achievements, the array is the sole repository.
- **Which one is the source of truth?** 
  - For academic library contributions: `user_achievements` is the source of truth.
  - For user interaction/social achievements: `users.achievements` is the source of truth.
- **Can one be removed later?** No, consolidation is possible but not recommended. The User document array provides O(1) checks for ranks and quick lists. The standalone collection stores historical metadata (`unlockedAt` date) for contributions which is needed for achievements views.
- **What UI/API would break if removed?**
  - Removing `users.achievements` breaks the `calculateRank` utility. Users would no longer level up beyond tier titles, and the settings achievements grid would empty.
  - Removing `user_achievements` breaks the contribution details dashboard showing dates of library contribution unlocks.

### B. `users` vs `user_contribution_stats`
- **Why is contribution stats separate from users?** It keeps the core User document lean. Contribution statistics are only relevant for users who submit papers.
- **Is it better to keep separate or merge into users?** Keep separate. 99% of regular users will not contribute to the library. Merging it would add 8 unused fields to every user document.
- **Which APIs/pages read it?** Read by the user profile details endpoint (`userController.ts`) and rendered in the profile statistics cards.
- **What would break if merged or removed?** Removing it breaks the contribution progress indicator, points system, and level badges on the UI. Merging does not break functionality but increases document bloat.
- **Is it a true source of truth or just a derived cache from `source_contributions`?** It is a derived cache. It is fully recalculated from `source_contributions` during rebuild runs.

### C. `users` vs `user_dream_profiles`
- **Is `user_dream_profiles` still used after deleting all documents?** Yes. It is accessed by the RAG orchestrator during dream analysis.
- **What code reads it?** `BE/src/services/analyze.service.ts` in `runDreamAnalysis`.
- **What code writes it?** `BE/src/controllers/authController.ts` in `updateProfile` and `verifyOtp` (registration).
- **Does the app recreate it automatically?** Yes, it upserts the profile automatically when a user updates settings or signs up, and lazy-backfills it if it is missing during dream analysis.
- **Does deleting all documents break any feature?** No immediate crashes, but it resets the user's custom psychological details to default templates and disables cultural analysis personalization until the user saves settings again.
- **If it is obsolete, list the exact code that should be removed later:** It is NOT obsolete. It is the core store for Component B analysis data.
- **If it is still needed, explain what data it should store and when:** It stores zodiac markers, Big Five scores, chronotype sleep behaviors, and learned symbol frequencies used to customize AI outputs.

### D. `users` Document Bloat
- **Which fields truly belong in users?** Credentials (`username`, `display_name`, `email`, `password`), profile info (`avatar`, `bio`), and active sessions (`sessions`).
- **Which fields are auth/profile/social core?** Social graph pointers (`followers`, `following`, `follower_count`) and account visibility flags.
- **Which fields are activity/rank counters?** Heartbeats, login history grids, streaks, online times, rank points, and current rank.
- **Which fields are cache/derived data?** The `achievements` array (mirrors contribution records and buffers rank unlocks).
- **Which fields could be moved to a separate stats/profile collection later?** 
  - Login histories (`loginHistory`, `timeOnlineToday`, `totalTimeOnline`, `lastActiveDate`) could be split into a `user_activities` collection.
  - Birth fields (`birth_date`, `birth_hour`, `fullName`, `gender`) can be removed, as they are mirrored in `user_dream_profiles`.

---

## 4. Database Integrity & Orphan Check Results

The read-only audit script performed **15 checks** on the active MongoDB database. Below are the results:

| Audit Check | Status | Count | Example IDs / Notes |
| :--- | :--- | :--- | :--- |
| **academic_chunks** without `academicSourceId` | ✅ Clear | 0 | None |
| **academic_chunks** pointing to missing `academic_sources` | ✅ Clear | 0 | None |
| **academic_fulltexts** pointing to missing `academic_sources` | ✅ Clear | 0 | None |
| **academic_fulltext_sections** pointing to missing `academic_fulltexts` | ✅ Clear | 0 | None |
| **knowledge_rule_candidates** pointing to missing academic sources/chunks | ✅ Clear | 0 | None |
| **knowledge_rules** (`source_generated`) with no evidence link | ✅ Clear | 0 | None |
| Active **knowledge_rules** without evidence links | ✅ Clear | 0 | None |
| Rejected candidates with active rules | ✅ Clear | 0 | None |
| **source_contributions** without user | ✅ Clear | 0 | None |
| **user_contribution_stats** without user | ✅ Clear | 0 | None |
| **user_achievements** without user | ✅ Clear | 0 | None |
| **user_dream_profiles** without user | ✅ Clear | 0 | None |
| **messages** without conversation | ✅ Clear | 0 | None |
| **comments** without dream | ⚠️ **Orphans Detected** | **14** | Point to deleted dream IDs: `6a0f47f150c4aaf31e5e5f5e`, `6a1005023f9a3d663aefa930`, `6a14a7616b641e859606eaba`, `6a14a7666b641e859606eabb`, `6a1815321b3f637469127ff4` |
| **notifications** without user (recipient/sender) | ✅ Clear | 0 | None |

---

## 5. Safe Cleanup Candidates (Low Risk)

The following items can be cleaned up without affecting the logic, UI, or active workflows:
1. **Drop Legacy Collection `knowledgerulecandidates`:** The collection name generated by default pluralization is completely empty and unused.
2. **Delete Orphan Comments:** Clear the 14 comments identified by the integrity check pointing to missing dream documents.
3. **Delete Expired Notifications:** Read notifications older than 30 days can be pruned safely.

---

## 6. Risky Deletion Candidates (Requires Approval)

The following deletions or migrations carry **high risk** and must not be run without approval:
1. **Pruning the `user_dream_profiles` collection:** Dropping this will break personalization features for users until they update their profile.
2. **Deleting "Seed" Rules in `knowledge_rules`:** Deleting these rules limits the Oracle's reasoning base.
3. **Dropping `user_contribution_stats`:** Breaks the user's Profile tab statistics immediately.

---

## 7. Recommended Future Schema Cleanup Plan

1. **Step 1: Cascade Delete Comments & Notifications (Highest Priority)**
   Modify [dreamController.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/controllers/dreamController.ts#L237) inside `deleteDream` to include:
   ```ts
   await Comment.deleteMany({ dreamId });
   await Notification.deleteMany({ postId: dreamId });
   ```
2. **Step 2: Formalize UserDreamProfile Model**
   Move the inline database queries out of [authController.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/controllers/authController.ts#L496) and create a formal Mongoose schema [UserDreamProfile.ts](file:///Users/helloduongnha/Documents/DreamScape/BE/src/models/UserDreamProfile.ts) to handle typing and validation.
3. **Step 3: Prune Redundant Fields in `dreams` Schema**
   Deprecate `visibility` (use `privacy`), `dreamText` (use `content`), and remove `aiAnalysis` from the schema.
4. **Step 4: Deprecate Duplicate Birth Fields in `users` Schema**
   Remove `fullName`, `gender`, `birth_date`, and `birth_hour` from the `users` collection, updating the frontend and backend profile endpoints to read these details directly from `user_dream_profiles.basicProfile`.

---

## 8. Questions / Unknowns

- **No Cascade Deletion for Follows/Likes:** If a user account is deleted, do we clean up likes on dreams? Do we pull them from followers/following arrays? Currently, no cascade deletion exists for users. We should define a user deletion policy.
- **Unverified PDFs in `academic_sources`:** Are we going to support purging of unverified contributions automatically after a specific timeframe?

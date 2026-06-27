const mongoose = require('mongoose');
const path = require('path');
const dotenv = require('dotenv');

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });

// Register ts-node on the fly
require('ts-node').register({
  project: path.resolve(__dirname, '../tsconfig.json'),
  transpileOnly: true
});

const User = require('../src/models/User').default;
const SourceContribution = require('../src/models/SourceContribution').default;
const UserContributionStats = require('../src/models/UserContributionStats').default;
const UserAchievement = require('../src/models/UserAchievement').default;
const { calculatePointsForSource, checkAndAwardLevelAchievements } = require('../src/services/contributionStats.service');

async function run() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  console.log('Connecting to MongoDB at:', uri);
  await mongoose.connect(uri);

  try {
    // 1. Clear existing contribution stats & achievements
    console.log('Clearing existing UserContributionStats and UserAchievements (source_contribution)...');
    await UserContributionStats.deleteMany({});
    await UserAchievement.deleteMany({ source: 'source_contribution' });

    // 2. Fetch all users
    const users = await User.find({});
    console.log(`Rebuilding contribution stats for ${users.length} users...`);

    for (const user of users) {
      // Clear achievements starting with 'contrib_level_' from the user safely
      await User.updateOne(
        { _id: user._id },
        { $pull: { achievements: { $regex: /^contrib_level_/ } } }
      );

      // Find all non-fake contributions submitted by this user
      // Non-fake means neither DOI nor normalizedDoi starts with 10.1234/
      const contributions = await SourceContribution.find({
        submittedBy: user._id,
        $and: [
          {
            $or: [
              { doi: { $exists: false } },
              { doi: null },
              { doi: { $not: /^10\.1234\// } }
            ]
          },
          {
            $or: [
              { normalizedDoi: { $exists: false } },
              { normalizedDoi: null },
              { normalizedDoi: { $not: /^10\.1234\// } }
            ]
          }
        ]
      });

      if (contributions.length === 0) {
        continue;
      }

      console.log(`User ${user.username} has ${contributions.length} contributions.`);

      let submittedSourceCount = contributions.length;
      let approvedSourceCount = 0;
      let rejectedSourceCount = 0;
      let pendingSourceCount = 0;
      let contributionPoints = 0;
      let lastContributionAt = null;

      for (const contrib of contributions) {
        if (!lastContributionAt || contrib.createdAt > lastContributionAt) {
          lastContributionAt = contrib.createdAt;
        }

        if (contrib.reviewStatus === 'approved') {
          approvedSourceCount++;
          // Calculate points
          contributionPoints += calculatePointsForSource(contrib);
        } else if (contrib.reviewStatus === 'rejected') {
          rejectedSourceCount++;
        } else {
          pendingSourceCount++;
        }
      }

      // Create new UserContributionStats document
      const stats = new UserContributionStats({
        userId: user._id,
        submittedSourceCount,
        approvedSourceCount,
        rejectedSourceCount,
        pendingSourceCount,
        contributionPoints,
        contributionLevel: 0, // Will be set by checkAndAwardLevelAchievements
        lastContributionAt
      });
      await stats.save();

      // Recalculate and award achievements
      await checkAndAwardLevelAchievements(user._id.toString(), approvedSourceCount);
      console.log(`Saved stats for user ${user.username}: approved=${approvedSourceCount}, points=${contributionPoints}`);
    }

    console.log('Stats rebuild completed successfully.');
  } catch (err) {
    console.error('Error rebuilding contribution stats:', err);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB disconnected.');
  }
}

run();

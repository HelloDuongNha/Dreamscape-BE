const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { default: Comment } = require('../dist/models/Comment');
const { default: Dream } = require('../dist/models/Dream');

async function cleanup() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/dreamscape';
  const args = process.argv.slice(2);
  const confirmDelete = args.includes('--confirm-delete');

  console.log('================================================================');
  console.log('ORPHAN COMMENTS CLEANUP SCRIPT');
  console.log(`Connecting to: ${uri}`);
  console.log(`Mode: ${confirmDelete ? '🚨 LIVE DELETION' : '🔍 DRY-RUN (No modifications)'}`);
  console.log('================================================================\n');

  try {
    await mongoose.connect(uri);

    // Fetch all comments
    const allComments = await Comment.find({}).lean();
    console.log(`Total comments found in DB: ${allComments.length}`);

    const orphanCommentIds = [];

    for (const comment of allComments) {
      const parentDreamExists = await Dream.exists({ _id: comment.dreamId });
      if (!parentDreamExists) {
        orphanCommentIds.push(comment._id);
      }
    }

    console.log(`Orphan comments found: ${orphanCommentIds.length}`);
    if (orphanCommentIds.length > 0) {
      console.log('Orphan Comment IDs:', orphanCommentIds.map(id => String(id)));
    }

    if (confirmDelete) {
      if (orphanCommentIds.length > 0) {
        console.log(`\nDeleting ${orphanCommentIds.length} orphan comments...`);
        const result = await Comment.deleteMany({ _id: { $in: orphanCommentIds } });
        console.log(`Deleted successfully. Mongoose delete result:`, result);
      } else {
        console.log('\nNo orphan comments to delete.');
      }
    } else {
      console.log('\n[Dry-run] To delete these comments, run with the flag: node scripts/cleanup_orphan_comments.js --confirm-delete');
    }

  } catch (err) {
    console.error('Error during cleanup:', err);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB.');
    console.log('================================================================');
  }
}

cleanup().catch(console.error);

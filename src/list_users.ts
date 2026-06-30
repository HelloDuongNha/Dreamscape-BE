import mongoose from 'mongoose';
import User from './models/User';

async function run() {
  const users = await User.find();
  console.log(`Found ${users.length} users:`);
  for (const u of users) {
    console.log(`- ID: ${u._id}, Username: ${u.username}, Email: ${u.email}`);
  }
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

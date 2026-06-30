import mongoose from 'mongoose';
import User from './models/User';

async function run() {
  const email = 'duongnha@dreamscape.io';
  let u = await User.findOne({ email });
  if (u) {
    u.password = '12345678';
    await u.save();
    console.log(`Password updated successfully for email: ${email}`);
  } else {
    console.log(`User not found for email: ${email}. Creating user...`);
    u = new User({
      username: 'duongnha',
      display_name: 'Duong Nha',
      email: email,
      password: '12345678'
    });
    await u.save();
    console.log(`User created successfully with email: ${email}`);
  }
  process.exit(0);
}

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/dreamscape')
  .then(() => run())
  .catch(err => {
    console.error(err);
    process.exit(1);
  });

import mongoose, { Document, Schema, Types } from 'mongoose';

/**
 * Represents the shape of a Notification document in MongoDB.
 */
export interface INotification extends Document {
  recipientId: Types.ObjectId; // User receiving the notification
  senderId:    Types.ObjectId; // User who performed the action
  type:        'like' | 'comment' | 'comment_reply' | 'follow' | 'dream_analysis';
  postId?:     Types.ObjectId; // The dream post linked to the notification
  commentId?:  Types.ObjectId; // Comment highlighted when the notification opens
  replyId?:    Types.ObjectId; // Reply event that produced a comment_reply notification
  isRead:      boolean;
  timestamp:   Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    recipientId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'recipientId is required'],
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'senderId is required'],
    },
    type: {
      type: String,
      enum: ['like', 'comment', 'comment_reply', 'follow', 'dream_analysis'],
      required: [true, 'Notification type is required'],
    },
    postId: {
      type: Schema.Types.ObjectId,
      ref: 'Dream',
      required: false,
    },
    commentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
      required: false,
      index: true,
    },
    replyId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
      required: false,
      index: true,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false, // timestamp is managed explicitly
  }
);

// Compound index to fetch unread/read notifications for a user sorted by newest first
NotificationSchema.index({ recipientId: 1, timestamp: -1 });

export default mongoose.model<INotification>('Notification', NotificationSchema);

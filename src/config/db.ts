import mongoose from 'mongoose';
import {
  domainDatabaseName,
  domainRoutingEnabled,
  waitForDomainConnections,
} from '../infrastructure/database/domainModels';

/**
 * Establishes a connection to MongoDB using the MONGODB_URI from environment variables.
 * Exits the process if the connection fails.
 */
const connectDB = async (): Promise<void> => {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error('❌ MONGODB_URI is not defined in environment variables.');
    process.exit(1);
  }

  try {
    const routingEnabled = domainRoutingEnabled();
    const conn = await mongoose.connect(
      uri,
      routingEnabled ? { dbName: domainDatabaseName('core') } : undefined,
    );
    await waitForDomainConnections();
    console.log(`✅ MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    if (routingEnabled) {
      console.log(
        `✅ MongoDB domains: core=${domainDatabaseName('core')}, `
        + `knowledge=${domainDatabaseName('knowledge')}, `
        + `operations=${domainDatabaseName('operations')}`,
      );
    }
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

export default connectDB;

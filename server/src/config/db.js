import mongoose from 'mongoose';

function sanitizeMongoUri(uri) {
  try {
    return uri.replace(/(mongodb(?:\+srv)?:\/\/)([^:]+):([^@]+)@/i, '$1$2:***@');
  } catch {
    return '<invalid-uri>';
  }
}

function getMongoDbNameFromUri(uri) {
  try {
    const u = new URL(uri);
    const p = (u.pathname || '').replace(/^\//, '');
    return p || null;
  } catch {
    return null;
  }
}

function looksLikeAtlasSrv(uri) {
  return /^mongodb\+srv:\/\//i.test(uri);
}

const connectDB = async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set in environment');
    process.exit(1);
  }

  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    console.error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    console.error('Current value (sanitized):', sanitizeMongoUri(uri));
    process.exit(1);
  }

  const dbName = getMongoDbNameFromUri(uri);
  if (!dbName) {
    console.warn('Warning: MONGODB_URI does not include a database name in the path. MongoDB will default to the "test" database.');
    console.warn('Fix by using: mongodb+srv://user:ENC_PASS@cluster.mongodb.net/linkvault?retryWrites=true&w=majority');
  }

  try {
    await mongoose.connect(uri, { autoIndex: true });
    console.log('MongoDB connected');
  } catch (err) {
    console.error('MongoDB connection error');
    console.error('MONGODB_URI (sanitized):', sanitizeMongoUri(uri));

    const code = err?.code || err?.errorResponse?.code;
    const msg = err?.errorResponse?.errmsg || err?.message || '';
    if (looksLikeAtlasSrv(uri) && (code === 8000 || /bad auth/i.test(msg))) {
      console.error('Atlas authentication failed (bad auth). Fix checklist:');
      console.error('1) Atlas Database Access: ensure the DB user exists and password is correct.');
      console.error('2) If the password contains special characters (@ : / ? # & % + etc), URL-encode it.');
      console.error('3) Atlas Network Access: allow your current IP (or 0.0.0.0/0 for dev only).');
      console.error('4) Use a full URI like: mongodb+srv://user:ENC_PASS@cluster.mongodb.net/linkvault?retryWrites=true&w=majority');
    } else {
      console.error(err);
    }
    process.exit(1);
  }
};

export default connectDB;

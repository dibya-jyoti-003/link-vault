
import 'dotenv/config';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
} from '@aws-sdk/client-s3';

const accountId = process.env.R2_ACCOUNT_ID;
const bucket = process.env.R2_BUCKET_NAME;
const endpoint = process.env.R2_ENDPOINT;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

console.log({
  bucket,
  endpoint,
  hasAccessKey: Boolean(accessKeyId),
  hasSecretKey: Boolean(secretAccessKey),
});

const s3 = new S3Client({
  region: 'auto',
  endpoint,
  credentials: {
    accessKeyId,
    secretAccessKey,
  },
});

try {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      MaxKeys: 5,
    })
  );

  console.log('R2 LIST SUCCESS');
  console.log(result);
} catch (err) {
  console.error('R2 LIST FAILED');
  console.error(err);
}

try {
  const result = await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: 'test.txt',
      Body: 'Hello from LinkVault',
      ContentType: 'text/plain',
    })
  );

  console.log('R2 UPLOAD SUCCESS');
  console.log(result);
} catch (err) {
  console.error('R2 UPLOAD FAILED');
  console.error(err);
}
import Share from '../models/Share.js';
import { deleteFile } from '../services/storage.js';
import cron from 'node-cron';

/**
 * Delete a share's storage object first and delete the MongoDB
 * record only after storage deletion succeeds.
 *
 * If R2 deletion fails, the database record is kept so the next
 * cleanup cycle can retry it.
 */
export async function purgeShare(share) {
  try {
    if (share?.type === 'file' && share?.file?.objectKey) {
      try {
        await deleteFile({ objectKey: share.file.objectKey });
      } catch (storageErr) {
        console.error(
          `Cleanup: failed to delete storage object for share ${
            share.shortId || share._id
          }; keeping database record for retry`,
          storageErr
        );
        return;
      }
    }

    await Share.deleteOne({ _id: share._id });
  } catch (err) {
    console.error('Error purging share', err);
  }
}

async function runCleanupCycle() {
  const now = new Date();

  try {
    const expired = await Share.find({
      expiresAt: { $lte: now },
    });

    if (expired.length > 0) {
      console.log(
        `Cleanup: Found ${expired.length} expired shares to delete`
      );
    }

    for (const share of expired) {
      await purgeShare(share);
    }
  } catch (err) {
    console.error('Cleanup cycle error', err);
  }
}

export default function startCleanupJob(
  cronExpression = '* * * * *'
) {
  // Run once immediately after startup.
  runCleanupCycle().catch((err) => {
    console.error('Initial cleanup failed', err);
  });

  const task = cron.schedule(
    cronExpression,
    () => {
      runCleanupCycle().catch((err) => {
        console.error('Scheduled cleanup failed', err);
      });
    },
    {
      name: 'linkvault-cleanup',
      noOverlap: true,
    }
  );

  return task;
}
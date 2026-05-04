import { Request, Response, Router } from 'express';
import { getPublicProfileActivityByHandle, getPublicProfileByHandle, getPublicProfileReputationByHandle } from '../services/profileService';

const router = Router();

router.get('/:handle', async (req: Request, res: Response) => {
  try {
    const profile = await getPublicProfileByHandle(req.params.handle);
    if (!profile) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, data: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load profile';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/:handle/reputation', async (req: Request, res: Response) => {
  try {
    const reputation = await getPublicProfileReputationByHandle(req.params.handle);
    if (!reputation) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, data: reputation });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load profile reputation';
    res.status(500).json({ success: false, error: message });
  }
});

router.get('/:handle/activity', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '25', 10);
    const activity = await getPublicProfileActivityByHandle(req.params.handle, limit);
    if (!activity) {
      return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    res.json({ success: true, data: activity });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load profile activity';
    res.status(500).json({ success: false, error: message });
  }
});

export default router;

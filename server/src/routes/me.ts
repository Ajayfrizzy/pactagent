import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { getMyProfile, updateMyProfile } from '../services/profileService';

const router = Router();

const profilePatchSchema = z.object({
  handle: z.string().min(3).max(32).optional(),
  displayName: z.string().max(80).optional(),
  bio: z.string().max(500).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  skills: z.array(z.string().min(1).max(40)).max(20).optional(),
  links: z.array(z.object({
    label: z.string().min(1).max(40),
    url: z.string().url(),
  })).max(8).optional(),
});

router.use(requireAuth);

router.get('/profile', async (req, res) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const profile = await getMyProfile(address);
    res.json({ success: true, data: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load profile';
    res.status(500).json({ success: false, error: message });
  }
});

router.patch('/profile', async (req, res) => {
  try {
    const address = req.auth?.address;
    if (!address) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }

    const data = profilePatchSchema.parse(req.body);
    const profile = await updateMyProfile(address, {
      ...data,
      avatarUrl: data.avatarUrl === '' ? undefined : data.avatarUrl,
    });
    res.json({ success: true, data: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to update profile';
    res.status(400).json({ success: false, error: message });
  }
});

export default router;

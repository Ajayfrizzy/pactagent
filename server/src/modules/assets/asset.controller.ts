import type { Request, Response } from 'express';
import { assets, BASE_SEPOLIA_CANDIDATE, legacyAsset } from './asset-registry';
import { ckbV1Semantics, describeRail, requireCapability } from '../escrows/adapters/rail-capabilities';
import { findEscrowForApp } from '../escrows/escrow.repository';
import { notFound } from '../../common/errors/app-error';

export function registry(_req: Request, res: Response) {
  res.json({ data: { version: 1, mode: 'read-only-foundation', assets, candidates: [BASE_SEPOLIA_CANDIDATE],
    ckbV1CodeSemantics: ckbV1Semantics, financialWrites: 'unavailable' } });
}
export async function escrowCapabilities(req: Request, res: Response) {
  const escrow = await findEscrowForApp(req.tenant!, req.params.id);
  if (!escrow) throw notFound();
  const capabilities = describeRail({ rail: escrow.rail, network: escrow.network,
    contractVersion: escrow.contractVersion, lockScriptJson: escrow.lockScriptJson, deploymentId: null });
  if (req.query.action !== undefined) requireCapability(capabilities, String(req.query.action));
  res.json({ data: { escrowId: escrow.id, metadata: legacyAsset(escrow), capabilities } });
}

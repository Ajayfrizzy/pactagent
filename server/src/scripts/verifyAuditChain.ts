import { prisma } from '../db';

async function main() {
  const result = await prisma.$queryRaw<Array<{ broken: bigint }>>`
    SELECT count(*)::bigint AS broken FROM "AuditLog" current
    WHERE current."recordHash" IS NOT NULL AND (
       (current."previousHash" IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM "AuditLog" previous WHERE previous."recordHash" = current."previousHash"
       ))
       OR current."recordHash" IS DISTINCT FROM encode(digest(concat_ws('|',
         coalesce(current."previousHash", ''), current."id", coalesce(current."appId", ''),
         current."actorType", current."action", current."resourceType", current."resourceId",
         coalesce(current."beforeJson", ''), coalesce(current."afterJson", ''), current."createdAt"::text
       ), 'sha256'), 'hex')
    )
  `;
  const broken = result[0]?.broken ?? 0n;
  if (broken > 0n) throw new Error(`Audit chain verification failed for ${broken} row(s).`);
  console.log('Audit chain verified.');
}

main().finally(() => prisma.$disconnect());

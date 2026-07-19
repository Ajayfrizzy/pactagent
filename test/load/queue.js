import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { queue: { executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '30s', preAllocatedVUs: 10 } },
  thresholds: { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<1000'] },
};

export default function () {
  const id = `${__VU}-${__ITER}`;
  const response = http.post(`${__ENV.BASE_URL}/v1/agreements`, JSON.stringify({
    title: `Load agreement ${id}`, description: 'Queue throughput fixture', clientExternalId: `c-${id}`,
    workerExternalId: `w-${id}`, totalAmount: '10000000000', currency: 'CKB', releaseMode: 'milestone', disputeMode: 'app_managed',
  }), { headers: { authorization: `Bearer ${__ENV.API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `load-${id}` } });
  check(response, { 'agreement accepted': (result) => [200, 201].includes(result.status) });
}

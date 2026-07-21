import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { queue: { executor: 'constant-arrival-rate', rate: 10, timeUnit: '1s', duration: '30s', preAllocatedVUs: 10 } },
  thresholds: { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<1000'] },
};

export default function () {
  const id = `${__VU}-${__ITER}`;
  const body = JSON.stringify({
    title: `Load agreement ${id}`, description: 'Queue throughput fixture', clientExternalId: `c-${id}`,
    workerExternalId: `w-${id}`, totalAmount: '10000000000', currency: 'CKB', releaseMode: 'milestone', disputeMode: 'app_managed',
  });
  const params = { headers: { authorization: `Bearer ${__ENV.API_KEY}`, 'content-type': 'application/json', 'idempotency-key': `load-${id}` } };
  const response = http.post(`${__ENV.BASE_URL}/v1/agreements`, body, params);
  const replay = http.post(`${__ENV.BASE_URL}/v1/agreements`, body, params);
  check(response, { 'agreement accepted': (result) => [200, 201].includes(result.status) });
  check(replay, {
    'idempotent replay succeeds': (result) => [200, 201].includes(result.status),
    'idempotent replay returns the same agreement': (result) => {
      try { return result.json('data.id') === response.json('data.id'); } catch (_) { return false; }
    },
  });
}

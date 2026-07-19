import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { webhooks: { executor: 'constant-arrival-rate', rate: 20, timeUnit: '1s', duration: '30s', preAllocatedVUs: 10 } },
  thresholds: { http_req_failed: ['rate<0.02'], http_req_duration: ['p(95)<750'] },
};

export default function () {
  const response = http.get(`${__ENV.BASE_URL}/v1/webhook-deliveries?limit=20`, {
    headers: { authorization: `Bearer ${__ENV.API_KEY}` },
  });
  check(response, { 'delivery list succeeds': (result) => result.status === 200 });
}

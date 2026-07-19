import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: { api: { executor: 'constant-arrival-rate', rate: 25, timeUnit: '1s', duration: '30s', preAllocatedVUs: 10 } },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<500'] },
};

const baseUrl = __ENV.BASE_URL || 'http://127.0.0.1:4000';
export default function () {
  const response = http.get(`${baseUrl}/health`);
  check(response, { 'health is 200': (result) => result.status === 200 });
}

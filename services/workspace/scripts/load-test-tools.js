import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const TOOL_ID = __ENV.TOOL_ID || "doi-to-bibtex";

const defaultBody = JSON.stringify({ identifier: "10.1038/nphys1170" });
const BODY = __ENV.BODY || defaultBody;

export const options = {
  vus: Number(__ENV.VUS || 20),
  duration: __ENV.DURATION || "1m",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
  },
};

export default function () {
  const url = `${BASE_URL}/api/tools/${TOOL_ID}`;
  const params = {
    headers: { "Content-Type": "application/json" },
  };
  const res = http.post(url, BODY, params);
  check(res, {
    "status is 200": (r) => r.status === 200,
  });
  sleep(1);
}

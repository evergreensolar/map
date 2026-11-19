# Evergreen Solar – Field Map: ERP Integration API Specification
Version 1.0

## 1. Overview
The ERP pushes enquiry and project data to the Field Map server. All calls are HTTPS `POST` with a JSON body.
Every request must have these headers:
- `Content-Type: application/json`
- `X-API-Key: <shared secret>` (the value of `ERP_API_KEY` in the Field Map `.env` file)

Base URL: `https://<field-map-server>/erp/v1`

Records are **upserted**: if the `enquiry_id` / `project_id` already exists it is updated, otherwise it is created.

**Partial updates (since v1.1):** on an update, only the fields you send are changed. A field you leave out keeps its saved value – e.g. `[{"project_id":"EVG-101","stage":"Dispatch pending"}]` changes only the stage. To clear a field, send it explicitly as `null` (e.g. `"engineer": null`). New records are created with whatever fields are sent.
So the ERP can send a record again every time anything changes (recommended: on every save / stage change), or send a full sync once a night.
A body can be a single object, an array of objects, or `{ "data": [ ... ] }`. Recommended batch size: up to 500 records per call.

## 2. Enquiries – `POST /erp/v1/enquiries`
| Field | Type | Required | Notes |
|---|---|---|---|
| enquiry_id | string | Yes | Unique ERP enquiry ID |
| customer_name | string | No | |
| phone | string | No | |
| pincode | string(6) | Yes* | Used to place the enquiry on the map |
| area | string | No | Locality / town name |
| source | string | No | e.g. Website, Facebook, Walk-in, Referral, PM Surya Ghar |
| enquiry_date | date | Yes | `YYYY-MM-DD` |
| status | string | No | e.g. OPEN, CONVERTED, LOST |
| assigned_to | string | No | Sales person name |
| lat, lng | number | No | If sent, used instead of pincode location |

Example:
```json
[{"enquiry_id":"ENQ-10231","customer_name":"Mr. Amit Das","phone":"98xxxxxx01","pincode":"700051","area":"Birati","source":"Website","enquiry_date":"2026-11-14","status":"OPEN","assigned_to":"Rahul"}]
```

## 3. Projects – `POST /erp/v1/projects`
| Field | Type | Required | Notes |
|---|---|---|---|
| project_id | string | Yes | Unique ERP project ID |
| customer_name | string | Yes | |
| phone | string | No | |
| address | string | No | |
| pincode | string(6) | Yes* | |
| lat, lng | number | Recommended | Exact site location (from site survey). Strongly preferred over pincode |
| capacity_kw | number | No | |
| stage | string | Yes | Current ERP step name (any of the 20-22 steps) – see section 4 |
| stage_date | date | Yes | Date the current step started / is due, `YYYY-MM-DD` |
| survey_date | date | No | Scheduled or done site-survey date |
| dispatch_date | date | No | |
| installation_date | date | No | |
| completion_date | date | No | |
| engineer | string | No | Assigned engineer / surveyor |
| team | string | No | Installation / survey team |
| created_date | date | No | Project creation date |

Example:
```json
{"data":[{"project_id":"PRJ-2026-0456","customer_name":"Mrs. Rina Ghosh","pincode":"700124","lat":22.7215,"lng":88.4812,"capacity_kw":5,"stage":"Dispatch Pending","stage_date":"2026-11-18","survey_date":"2026-11-02","engineer":"Sourav","team":"Team A","created_date":"2026-10-28"}]}
```

## 4. Stage mapping (Evergreen workflow)
Send one of these codes in `stage` (preferred). ERP step names are also auto-mapped.
| Code | Meaning |
|---|---|
| ENQUIRY | New enquiry |
| SURVEY_REQUESTED | Sales sent to site survey, with project coordinator |
| SURVEY_SCHEDULED | Coordinator scheduled an engineer (send `survey_date`, `engineer`) |
| SURVEY_DONE | Engineer submitted survey |
| DESIGN_PENDING | With design team |
| DESIGN_DONE | Design complete, waiting for customer confirmation |
| PROJECT_CREATED | Customer confirmed, project created |
| AGREEMENT_PENDING | Agreement stage |
| DISPATCH_PENDING | Dispatch stage |
| INSTALLATION_PENDING | Installation stage |
| NET_METERING_PENDING | Net metering pending |
| DOCUMENT_SENDING | Document sending |
| COMPLETED | Closed |

Note: records should be sent from the **site survey stage onwards** (use the enquiry ID as `project_id` until a project number exists, or send the project number once created – keep the same ID if possible).

## 4A. Service tickets – `POST /erp/v1/service`
For after-sales maintenance tickets, panel cleaning and AMC visits.
| Field | Type | Required | Notes |
|---|---|---|---|
| ticket_id | string | Yes | Unique ticket ID |
| type | string | Yes | MAINTENANCE, CLEANING or AMC |
| customer_name, phone, address | string | Yes | |
| pincode | string(6) | Yes* | |
| lat, lng | number | Recommended | |
| project_id | string | No | Original installation project |
| issue | string | No | Problem description |
| status | string | Yes | OPEN, SCHEDULED, CLOSED |
| scheduled_date | date | No | `YYYY-MM-DD` |
| engineer, team | string | No | |
| created_date | date | No | |

Example:
```json
[{"ticket_id":"TKT-889","type":"MAINTENANCE","customer_name":"Mr. Sanjay Paul","phone":"98xxxxxx22","pincode":"700128","status":"SCHEDULED","scheduled_date":"2026-11-19","issue":"Inverter not starting","project_id":"PRJ-2025-0112"}]
```
Delete: `DELETE /erp/v1/service/{ticket_id}`

## 5. Pincode master (optional) – `POST /erp/v1/pincodes`
`[{"pincode":"700051","lat":22.668,"lng":88.433,"area":"Birati"}]`
If not sent, the Field Map looks up pincode locations automatically from OpenStreetMap.

## 6. Delete
`DELETE /erp/v1/projects/{project_id}` and `DELETE /erp/v1/enquiries/{enquiry_id}`

## 7. Health check
`GET /erp/v1/health` → `{"ok":true}` (with API key)

## 8. Responses
Success: `200 {"received":10,"saved":9,"errors":[{"index":4,"error":"project_id missing"}]}`
Wrong key: `401 {"error":"invalid API key"}`.
Dates must be `YYYY-MM-DD`; `DD/MM/YYYY` is also accepted.

## 9. Integration options for ERP team
1. **Push on change (recommended):** call the API whenever an enquiry is created/updated or a project changes step.
2. **Nightly full sync:** send all open enquiries and all projects once per day in batches of 500.

## 10. Inverter RMS (internal – not for ERP team)
Inverter / data-logger serial numbers are linked to projects manually in the **RMS / Generation** tab.
The server polls each brand's cloud API every `RMS_POLL_MINUTES` and stores today's kWh per inverter.
Supported: Growatt (OpenAPI token), Deye via Solarman (App ID + Secret + account), Sungrow iSolarCloud (App key + access key + account). PVblink Open API v1 (Client ID + Secret + account email/password; needs data-logger serial).
Keys go in the `.env` file only.

## 11. Website enquiries (Smart Evergreen public page → ERP)
Customers submit the form on https://smart.evergreensolar.co.in. Two ways for the ERP to receive them – use either one:

**A. Push (recommended):** ERP gives us a URL. We `POST` each enquiry immediately as JSON, header `X-API-Key: <ERP_WEBHOOK_KEY>`:
```json
{"ref":"WEB-LZ8K2A","customer_name":"Mr. Arup Sen","email":"arup@example.com","pincode":"700132","segment":"DOMESTIC","phone":"98xxxxxx45","monthly_bill":"3500","monthly_bill":"3500","message":"","source":"Smart Evergreen website","created_at":"2026-11-16T09:10:00.000Z"}
```
Required: customer_name, phone, email, pincode, segment (DOMESTIC or COMMERCIAL), monthly_bill (₹, average). Optional: message. (Field names can be changed to match the ERP API when it is shared.) ERP should reply HTTP 200. Failed sends are retried automatically for 3 days.

**B. Pull:** `GET /erp/v1/web-enquiries?since=<ISO time of last fetch>` (header X-API-Key) returns new enquiries.
Then `POST /erp/v1/web-enquiries/ack` with `["WEB-LZ8K2A", ...]` to mark them received. Response: `{"ok":true,"acknowledged":<refs found>,"received":<refs sent>,"unknown":<refs not found>}`.

Please use `ref` as the ERP enquiry reference so the same enquiry is not created twice.

## 12. Alternative: Field Map PULLS from the ERP (read-only GET URLs)
If pushing is not convenient, the ERP can expose **three read-only GET URLs**; the Field Map pulls them automatically at fixed India times – by default every 6 hours (12 am, 6 am, 12 pm, 6 pm IST; admin can change to 1/3/12/24 hours) – and admin can press "Pull now" any time in the API Docs tab.

| Data | Default path | Same fields as |
|---|---|---|
| Projects | `GET {ERP_BASE}/projects` | section 3 (`project_id`, `customer_name`, `phone`, `address`, `pincode`, `lat`, `lng`, `capacity_kw`, `stage`, dates, `engineer`, `team`) |
| Enquiries | `GET {ERP_BASE}/enquiries` | section 2 |
| Service tickets | `GET {ERP_BASE}/service` | section 4A |

- Auth: one key in a header – `X-API-Key: <key>` (or `Authorization: Bearer <key>`). The key is entered by our admin in the app; it is never put in code.
- Response: a JSON array, or an object with the list in `data` / `items` / `results` / `records` / `rows`.
- Paging (optional): include `next` (or `next_page_url`, `links.next`, `meta.next`) with the URL/path of the next page; the Field Map follows it until it is empty.
- Paths can be changed in the app if the ERP uses different ones.
- Please send us: the base URL, the key, and one sample response.

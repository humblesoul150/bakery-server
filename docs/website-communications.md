# Website communications setup

The communications feature stores website contact/custom-order messages and newsletter consent in the bakery database. It uses Resend for outbound mail, inbound email retrieval, and the newsletter segment. It does not create an order from a website enquiry or connect demo checkout to purchase emails.

## Backend configuration

Set these variables in the backend deployment environment:

- `RESEND_API_KEY`: Resend API key with permission for the configured sending domain, contacts, segments, and broadcasts.
- `RESEND_WEBHOOK_SECRET`: signing secret for the Resend webhook configured to post to `/api/webhooks/resend`.
- `PUBLIC_STOREFRONT_URL`: canonical HTTPS storefront origin used for verification and unsubscribe links.
- `RESEND_FROM_INFO`, `RESEND_FROM_ORDERS`, `RESEND_FROM_SALES`, `RESEND_FROM_NEWSLETTER`: verified sender addresses in `Name <email@domain>` format.
- `RESEND_NEWSLETTER_SEGMENT_ID`: the Resend segment used for verified newsletter subscribers.
- `NEWSLETTER_TOKEN_SECRET`: a long, random secret used to sign unsubscribe links. Rotating it invalidates existing unsubscribe links; send a new newsletter to provide fresh links.

Set `BAKERY_API_URL` in the website deployment to the backend origin without `/api`. The website server proxies contact, custom-order, and newsletter requests through same-origin routes. Do not expose the Resend API key in a `NEXT_PUBLIC_*` variable.

## Resend and inbound email

Configure the Resend webhook for `email.received`, `email.bounced`, `email.complained`, `email.suppressed`, `contact.updated`, and `suppression.added` events. The backend verifies the raw request body against Resend's signature before processing. For received mail, the backend retrieves the email content through the Resend receiving API and routes messages sent to the configured info, orders, or sales addresses into the appropriate conversation queue. Replies with matching message references are appended to the existing conversation. Broadcasts use Resend's `{{{RESEND_UNSUBSCRIBE_URL}}}` merge tag; `contact.updated` events synchronize those opt-outs back to the bakery database.

Inbound delivery requires the operator to configure and verify the bakery domain's DNS/MX records with Resend. No DNS records are changed by this application. Until that is done, website forms and outbound mail can still be tested independently, but inbound email will not arrive.

## Consent and campaign rules

Newsletter records remain pending until the verification link is used. Only active records with a verification timestamp and successful Resend segment synchronization are counted as campaign recipients. Campaign content supports headings, paragraphs, buttons, and images; button/image URLs are restricted to HTTP(S). Each confirmed subscriber receives an application unsubscribe link in the welcome email. Broadcasts use Resend's built-in unsubscribe link, which updates the provider contact; `contact.updated` webhook events update the local subscription status.

Unsubscribes, suspensions, and provider suppression events remove a contact from the active Resend segment. Administrative deletion requires email confirmation, suppresses the provider contact first, and then deletes the local record. Provider suppression is retained so a deleted address is not inadvertently re-added to an active marketing segment.

Message access is available to Admin, General Manager, Sales Manager, and Marketing Manager roles. Newsletter management is limited to Admin, General Manager, and Marketing Manager roles; Super Admin retains access. The API applies these checks independently of the administration client.

## Operational checks

1. Configure and verify the sender domain and DNS/MX records in Resend.
2. Set the environment values above and create a Resend segment for newsletter subscribers.
3. Configure the signed webhook URL and send a Resend test event.
4. Submit a contact form and custom-order enquiry; confirm each appears in the inbox and receives a reference.
5. Test newsletter signup, confirmation, unsubscribe, Resend synchronization, and a test campaign before sending any live broadcast.
6. Confirm the production privacy notice and consent wording are approved before collecting real subscriptions.

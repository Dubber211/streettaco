// This Edge Function runs on Supabase's servers (using Deno, not Node).
// It gets called when we want to notify users about a new truck.
// It reads all push subscriptions from the database and sends
// a push message to each one using the Web Push protocol.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push?target=deno";

Deno.serve(async (req: Request) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Parse the incoming payload — what notification to send
    const { title, body, url } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title and body are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // VAPID keys — our app's identity for push services
    const vapid = {
      subject: Deno.env.get("VAPID_EMAIL")!,
      publicKey: Deno.env.get("VAPID_PUBLIC_KEY")!,
      privateKey: Deno.env.get("VAPID_PRIVATE_KEY")!,
    };

    // Connect to Supabase with the service_role key so we can read all subscriptions
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch all push subscriptions
    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*");

    if (fetchError) {
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    // The payload is what the service worker's "push" event will receive
    const message = {
      data: JSON.stringify({ title, body, url: url || "/" }),
      options: { ttl: 3600 },
    };

    // Send a push message to each subscription
    let sent = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    for (const sub of subscriptions || []) {
      try {
        // Build the encrypted push request
        const subscription = {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: sub.keys,
        };

        const payload = await buildPushPayload(message, subscription, vapid);

        // Send it to the browser's push service
        const pushResponse = await fetch(sub.endpoint, payload);

        if (pushResponse.status === 201) {
          sent++;
        } else if (pushResponse.status === 404 || pushResponse.status === 410) {
          // 410 Gone = user unsubscribed or subscription expired
          staleEndpoints.push(sub.endpoint);
          failed++;
        } else {
          console.error(`Push failed for ${sub.endpoint}: ${pushResponse.status} ${await pushResponse.text()}`);
          failed++;
        }
      } catch (err) {
        console.error(`Push error for ${sub.endpoint}:`, err);
        failed++;
      }
    }

    // Delete any stale subscriptions we found
    if (staleEndpoints.length > 0) {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("endpoint", staleEndpoints);
    }

    return new Response(
      JSON.stringify({ sent, failed, cleaned: staleEndpoints.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Push function error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

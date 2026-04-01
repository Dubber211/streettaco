// This Edge Function runs on Supabase's servers (using Deno, not Node).
// It gets called when we want to notify users about a new truck.
// It reads all push subscriptions from the database and sends
// a push message to each one using the Web Push protocol.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

// Web Push requires signing requests with VAPID keys.
// These helpers handle the crypto (JWT signing + payload encryption).
import { importVapidKey, generatePushHTTPRequest } from "https://esm.sh/webpush-webcrypto@1";

serve(async (req: Request) => {
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

    // Grab our VAPID keys from Supabase secrets (set earlier via CLI)
    const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY")!;
    const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY")!;
    const vapidEmail = Deno.env.get("VAPID_EMAIL")!;

    // Import the VAPID key into a format the crypto library can use
    const applicationServerKeys = await importVapidKey(
      { publicKey: vapidPublicKey, privateKey: vapidPrivateKey },
    );

    // Connect to Supabase with the service_role key so we can read all subscriptions
    // (our RLS policy only allows service_role to SELECT from push_subscriptions)
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
    const payload = JSON.stringify({ title, body, url: url || "/" });

    // Send a push message to each subscription
    let sent = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    for (const sub of subscriptions || []) {
      try {
        // Build the encrypted push request
        const { headers, body: pushBody, endpoint } = await generatePushHTTPRequest({
          applicationServerKeys,
          payload,
          target: {
            endpoint: sub.endpoint,
            keys: sub.keys,
          },
          adminContact: vapidEmail,
          ttl: 60 * 60, // message expires after 1 hour
        });

        // Send it to the browser's push service (e.g., Firebase Cloud Messaging)
        const pushResponse = await fetch(endpoint, {
          method: "POST",
          headers,
          body: pushBody,
        });

        if (pushResponse.status === 201) {
          sent++;
        } else if (pushResponse.status === 404 || pushResponse.status === 410) {
          // 410 Gone = user unsubscribed or subscription expired
          // Clean up stale subscriptions so we don't keep trying
          staleEndpoints.push(sub.endpoint);
          failed++;
        } else {
          console.error(`Push failed for ${sub.endpoint}: ${pushResponse.status}`);
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

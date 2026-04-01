// This Edge Function runs on Supabase's servers (using Deno, not Node).
// It gets called when we want to notify users about a new truck.
// It reads all push subscriptions from the database and sends
// a push message to each one using the Web Push protocol.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { buildPushPayload } from "https://esm.sh/@block65/webcrypto-web-push?target=deno";

// Haversine formula — same math as the frontend uses
function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { title, body, url, type, truck_id, truck_lat, truck_lng } = await req.json();
    if (!title || !body) {
      return new Response(JSON.stringify({ error: "title and body are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const vapid = {
      subject: Deno.env.get("VAPID_EMAIL")!,
      publicKey: Deno.env.get("VAPID_PUBLIC_KEY")!,
      privateKey: Deno.env.get("VAPID_PRIVATE_KEY")!,
    };

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from("push_subscriptions")
      .select("*");

    if (fetchError) {
      throw new Error(`Failed to fetch subscriptions: ${fetchError.message}`);
    }

    // Filter subscriptions based on notification type
    const targets = (subscriptions || []).filter((sub) => {
      if (type === "favorite") {
        // Only notify users who have this truck in their favorites
        return sub.favorites && sub.favorites.includes(truck_id);
      }
      // "new_truck" type — only notify users within their radius
      if (truck_lat != null && truck_lng != null && sub.lat != null && sub.lng != null) {
        const dist = haversineMiles(sub.lat, sub.lng, truck_lat, truck_lng);
        return dist <= (sub.radius_miles || 25);
      }
      // No location stored — send it anyway (they haven't shared location yet)
      return sub.lat == null;
    });

    const message = {
      data: JSON.stringify({ title, body, url: url || "/" }),
      options: { ttl: 3600 },
    };

    let sent = 0;
    let failed = 0;
    const staleEndpoints: string[] = [];

    for (const sub of targets) {
      try {
        const subscription = {
          endpoint: sub.endpoint,
          expirationTime: null,
          keys: sub.keys,
        };

        const payload = await buildPushPayload(message, subscription, vapid);
        const pushResponse = await fetch(sub.endpoint, payload);

        if (pushResponse.status === 201) {
          sent++;
        } else if (pushResponse.status === 404 || pushResponse.status === 410) {
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

    if (staleEndpoints.length > 0) {
      await supabaseAdmin
        .from("push_subscriptions")
        .delete()
        .in("endpoint", staleEndpoints);
    }

    return new Response(
      JSON.stringify({ sent, failed, cleaned: staleEndpoints.length, filtered: (subscriptions?.length || 0) - targets.length }),
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

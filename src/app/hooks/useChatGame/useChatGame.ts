import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabaseClient";

export function useChatGame(
  currentUser: { name: any; sunSign?: string; avatarUrl?: string },
  characters: {
    name: string;
    sunSign: string;
    avatarUrl: string;
    motivation: string;
  }[]
) {
  const [messages, setMessages] = useState<
    { content: string; created_at: string; sender: string }[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [gameId, setGameId] = useState<string | null>(null);

  const isStreamingRef = useRef(false);
  const streamingMsgIndexRef = useRef<number | null>(null);

  const roomChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  // tracks in-flight scenario message indices by a stream key
  const inflightByKeyRef = useRef<Record<string, number>>({});


  useEffect(() => {
      setGameId("d15df0fe-814f-4e69-b4c4-e5d3a94bb64d");

    if (!gameId) return;

    async function loadInitial() {
      const [responses, system_response] = await Promise.all([
        supabase
          .from("player_responses")
          .select("user_id, content, created_at")
          .eq("room", gameId),
        // supabase
        //   .from("scenario_steps")
        //   .select("ai_markdown, created_at")
        //   .eq("game_id", gameId),
          supabase
            .from("system_responses")
            .select("content, created_at")
            .eq("room", gameId)
      ]);

      const all = [
        ...(responses.data || []).map((r) => ({
          content: `${r.user_id}: ${r.content}`,
          created_at: r.created_at,
          sender: r.user_id,
        })),
        // ...(steps.data || []).map((s) => ({
        //   content: s.ai_markdown,
        //   created_at: s.created_at,
        //   sender: "Scenario",
        // })),
                ...(system_response.data || []).map((s) => ({
          content: s.content,
          created_at: s.created_at,
          sender: "Scenario",
        })),
      ].sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );

      setMessages(all);
    }

    loadInitial();

    // const channel = supabase.channel("chat_room_live");
      // 2) Broadcast channel for live streaming
  const channel = supabase.channel(`room:${gameId}`, {
    config: { broadcast: { ack: true } },
  });

    channel
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "player_responses" },
        (payload) => {
          console.log({playerSubscription: payload})
          const msg = payload.new;
          setMessages((prev) => [
            ...prev,
            {
              content: `${msg.user_id}: ${msg.content}`,
              created_at: msg.created_at,
              sender: msg.user_id,
            },
          ]);
        }
      )
      // .on(
      //   "postgres_changes",
      //   { event: "INSERT", schema: "public", table: "scenario_steps" },
      //   (payload) => {
      //     const step = payload.new;
      //     setMessages((prev) => [
      //       ...prev,
      //       {
      //         content: step.content,
      //         created_at: step.created_at,
      //         sender: "Scenario",
      //       },
      //     ]);
      //   }
      // )
            .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "system_responses" },
        (payload) => {
          const step = payload.new;
          setMessages((prev) => [
            ...prev,
            {
              content: step.content,
              created_at: step.created_at,
              sender: "Scenario",
            },
          ]);
        }
      )
      .subscribe();



  channel
    .on("broadcast", { event: "scenario_chunk" }, (evt) => {
      const { streamKey, delta } = evt.payload as { streamKey: string; delta: string };

      // If first time we see this streamKey, create a local pending Scenario message
      if (inflightByKeyRef.current[streamKey] == null) {
        const createdAt = new Date().toISOString();
        let idx = -1;
        setMessages((prev) => {
          const next = prev.slice();
          next.push({ content: "", created_at: createdAt, sender: "Scenario" });
          idx = next.length - 1;
          return next;
        });
        inflightByKeyRef.current[streamKey] = idx;
      }

      // Append the delta to that pending message
      const targetIdx = inflightByKeyRef.current[streamKey];
      setMessages((prev) => {
        const next = prev.slice();
        if (next[targetIdx]) {
          next[targetIdx] = { ...next[targetIdx], content: next[targetIdx].content + (delta || "") };
        }
        return next;
      });
    })
    .on("broadcast", { event: "scenario_done" }, (evt) => {
      // When producer signals done, drop the local pending (we'll rely on DB INSERT)
      const { streamKey } = evt.payload as { streamKey: string };
      const idx = inflightByKeyRef.current[streamKey];
      if (idx != null) {
        setMessages((prev) => {
          // remove the pending line; DB INSERT will add the final one
          const next = prev.slice();
          next.splice(idx, 1);
          return next;
        });
        delete inflightByKeyRef.current[streamKey];
      }
    })
    .subscribe();

  roomChannelRef.current = channel;

  return () => {
    supabase.removeChannel(channel);
    if (roomChannelRef.current) {
      supabase.removeChannel(roomChannelRef.current);
      roomChannelRef.current = null;
    }
  };
}, [gameId]);

  

  const handleStart = useCallback(
    async (message: { message: any }) => {
      // TEMPORARILY PLAYING THE SAME GAME
      // const newId = crypto.randomUUID();
      setGameId("d15df0fe-814f-4e69-b4c4-e5d3a94bb64d");
      // setMessages([]);
      // supabase
      //   .from("games")
      //   .insert([{ id: newId, title: "test", code: "BBB124" }])
      //   .then(() => {
      //     setGameId(newId);
      //   });
    },
    [characters, supabase]
  );

  

  const handleSend = useCallback(
    async (message: string | { message: string }) => {
      if (!gameId) return;

      const text = typeof message === "string" ? message : message?.message;
      if (!text?.trim()) return;

      // 1) persist player message (others will see via Realtime)
      await supabase
        .from("player_responses")
        .insert([{ room: gameId, user_id: currentUser.name, content: text }]);
        const createdAt = new Date().toISOString();

              setMessages((prev) => [
        ...prev,
        {
          content: text,
          created_at: createdAt,
          sender: currentUser.name,
        },
      ]);
      // 2) call server to start AI stream
      setLoading(true);
      isStreamingRef.current = true;

      // A unique key for this streamed AI response (same across all clients)
      const streamKey = `${gameId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", 'Cache-Control': 'no-cache, no-transform' },
          body: JSON.stringify({
            gameId,
            characters, // optional, but supported by your route
            message: `${currentUser.name}: ${text}`,
          }),
        });

        const reader = res.body?.getReader();
        if (!reader) {
          setLoading(false);
          isStreamingRef.current = false;
          return;
        }

        // 3) add a pending Scenario message we will grow with chunks
        const createdAt = new Date().toISOString();
        let idx = -1;
        setMessages((prev) => {
          const next = prev.slice();
          next.push({ content: "", created_at: createdAt, sender: "Scenario" });
          idx = next.length - 1;
          streamingMsgIndexRef.current = idx;
          return next;
        });

        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

       const roomChannel = roomChannelRef.current;   

        const appendDeltaLocal = (delta: string) => {
          fullText += delta;
        if (!delta) return;
        setMessages((prev) => {
          const next = prev.slice();
          const i = streamingMsgIndexRef.current ?? next.length - 1;
          if (!next[i]) return prev;
          next[i] = { ...next[i], content: next[i].content + delta };
          return next;
        });
      };

        const broadcastDelta = async (delta: string) => {
          if (!roomChannel) return;
          await roomChannel.send({
            type: "broadcast",
            event: "scenario_chunk",
            payload: { streamKey, delta },
          });
        };

        // Supports either raw text chunks OR SSE "data: {json}" lines
        const extractContent = (chunk: string) => {
          // If SSE style, parse lines; otherwise treat as raw text
          let out = "";
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const payload = line.slice(6).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload); // OpenAI SSE delta
                out += parsed?.choices?.[0]?.delta?.content ?? "";
              } catch {
                // not JSON; just append as text
                out += payload;
              }
            } else {
              // raw chunk or plain text line
              out += line;
              if (lines.length > 1) out += "\n";
            }
          }
          return out;
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = decoder.decode(value, { stream: true });
          // appendDelta(extractContent(buffer));
          const delta = extractContent(buffer);
          if (delta) {
            appendDeltaLocal(delta);      // sender sees it instantly
            broadcastDelta(delta);        // everyone else sees it via broadcast
          }
        }

        // Tell listeners to drop their pending buffer line
      await roomChannel?.send({
        type: "broadcast",
        event: "scenario_done",
        payload: { streamKey },
      });

      // One final durable insert of the AI message
      if (fullText) {
        // await supabase.from("player_responses").insert([
        //   { room: gameId, user_id: "Scenario", content: fullText },
        // ]);
      }

      // Sender also removes local pending to avoid double
      // setMessages((prev) => {
      //   const next = prev.slice();
      //   const i = streamingMsgIndexRef.current ?? idx;
      //   if (next[i]?.sender === "Scenario" && next[i]?.content !== undefined) {
      //     next.splice(i, 1);
      //   }
      //   return next;
      // });
      } catch (e) {
        console.error("stream error", e);
      } finally {
        setLoading(false);
        // Let Realtime deliver the final persisted row; avoid doubling.
        // Optional: mark streaming done so your system_responses listener
        // can ignore the very next insert if its content equals the streamed one.
        isStreamingRef.current = false;
        streamingMsgIndexRef.current = null;
      }
    },
    [gameId, currentUser.name, characters] // include characters in deps if not stable
  );

  return { messages, loading, handleSend, handleStart, gameId };
}

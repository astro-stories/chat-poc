import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/app/lib/supabaseClient";

export const runtime = "nodejs";
export const dynamic = 'force-dynamic'; // prevent static optimization


interface PlayerCharacter {
  name: string;
  sunSign: string;
  motivation: "personal" | "investigative" | "accidental";
}

function formatCharacters(characters: PlayerCharacter[]) {
  return characters
    .map(
      (c) =>
        `- **${c.name}** (${c.sunSign}) — drawn in by ${c.motivation} motives.`
    )
    .join("\n");
}

export async function POST(req: Request) {
  const body = await req.json();
  console.log({chatRouteBody: body})
  const { gameId, characters, new_response } = body || {};

  // const isFirstStep = new_response?.step_number === 0; //until steps are implemented

  // const { data: priorResponses } = await supabase
  //   .from("player_responses")
  //   .select("content, user_id, created_at")
  //   .eq("room", gameId);

  // const { data: systemResponses } = await supabase
  //   .from("system_responses")
  //   .select("content, created_at")
  //   .eq("room", gameId);



    ///
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

    ///

  const isFirstStep = all?.length == 1; 

  console.log({isFirstStep})
  const responseMessages =
    all?.map((r: any) => ({
      role: r.sender == 'Scenario' ? 'assistant' : 'user',
      content: `${r.content}`,
    })) || [];

  if (new_response?.user_id && new_response?.content) {
    responseMessages.push({
      role: "user",
      content: `${new_response.player_id} responds: ${new_response.content}`,
    });
  }

  const systemPrompt = isFirstStep
    ? `Design the opening scene of a surreal investigative cosmic horror RPG. The setup should hint at an ancient force and strange disappearances.

Introduce characters using their zodiac archetypes:

${formatCharacters(characters)}

Begin with eerie tension and mystery. Return only the first short paragraph of the story in clean, spooky Markdown.`
    : `Continue the RPG story based on the following player input.

Characters:
${formatCharacters(characters)}

Respond with one short paragraph, max 2 sentences.`;

console.log({systemPrompt})
console.log({responseMessages})

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4",
      stream: true,
      messages: [
        { role: "system", content: systemPrompt },
        ...responseMessages,
      ],
    }),
  });

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let cleanNarrative = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = response.body?.getReader();
      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);

          for (const line of chunk.split("\n")) {
            if (line.startsWith("data: ")) {
              const json = line.replace("data: ", "").trim();
              if (json && json !== "[DONE]") {
                try {
                  const parsed = JSON.parse(json);
                  const content = parsed.choices?.[0]?.delta?.content;
                  if (content) {
                    cleanNarrative += content;
                    controller.enqueue(encoder.encode(content));
                  }
                } catch (e) {
                  console.error("Error parsing chunk", json);
                }
              }
            }
          }
        }

        // determine step number
        // let stepNumber = 0;
        // if (new_response?.step_number !== undefined) {
        //   stepNumber = new_response.step_number;
        // } else {
        //   const { data: existing } = await supabase
        //     .from("scenario_steps")
        //     .select("step_number")
        //     .eq("game_id", gameId)
        //     .order("step_number", { ascending: false })
        //     .limit(1);

        //   stepNumber = existing?.[0]?.step_number + 1 || 0;
        // }

        await supabase.from("system_responses").insert([
          {
            room: gameId,
            content: cleanNarrative.trim(),
            // step_number: stepNumber,
          },
        ]);
      }
      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

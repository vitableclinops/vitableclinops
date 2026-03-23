import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GATEWAY_URL = 'https://connector-gateway.lovable.dev/slack/api';
const BIRTHDAY_CHANNEL_ID = 'C08S37P766R'; // #clinops-escalations

const BIRTHDAY_GIFS = [
  'https://media.giphy.com/media/g5R9dok94mrIvplmZd/giphy.gif',
  'https://media.giphy.com/media/WRL7YgP42OKns6FXkT/giphy.gif',
  'https://media.giphy.com/media/l4KibWpBGWchSqCRy/giphy.gif',
  'https://media.giphy.com/media/26FPpSuhgHjRnpTmU/giphy.gif',
  'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif',
  'https://media.giphy.com/media/MViYNpLRD1cqc/giphy.gif',
  'https://media.giphy.com/media/l0MYGb1LuZ3n7dRnO/giphy.gif',
  'https://media.giphy.com/media/SwIMZUJE3ZPpHAfTC4/giphy.gif',
];

const BIRTHDAY_MESSAGES = [
  "Wishing you the happiest of birthdays! 🥳",
  "Hope your day is as amazing as you are! 🎉",
  "Cheers to another year of awesomeness! 🎊",
  "May your birthday be filled with joy and cake! 🎂",
  "Another trip around the sun — let's celebrate! ☀️",
  "Here's to you on your special day! 🥂",
];

function getChicagoDate(): string {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY is not configured');

    const SLACK_API_KEY = Deno.env.get('SLACK_API_KEY');
    if (!SLACK_API_KEY) throw new Error('SLACK_API_KEY is not configured');

    // Get today's date in Chicago timezone
    const todayStr = getChicagoDate(); // YYYY-MM-DD
    const [, monthStr, dayStr] = todayStr.split('-');
    const monthDay = `${monthStr}-${dayStr}`; // MM-DD

    // Find providers whose birthday is today (matching month and day)
    const { data: providers, error } = await supabase
      .from('profiles')
      .select('id, full_name, date_of_birth, email, is_active')
      .not('date_of_birth', 'is', null)
      .eq('is_active', true);

    if (error) throw new Error(`Failed to fetch providers: ${error.message}`);

    // Filter for birthdays matching today's month/day
    const birthdayProviders = (providers || []).filter((p) => {
      if (!p.date_of_birth) return false;
      const dob = p.date_of_birth as string; // YYYY-MM-DD
      const dobMonthDay = dob.substring(5); // MM-DD
      return dobMonthDay === monthDay;
    });

    if (birthdayProviders.length === 0) {
      console.log('No birthdays today');
      return new Response(
        JSON.stringify({ success: true, message: 'No birthdays today', sent: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let sentCount = 0;

    for (const provider of birthdayProviders) {
      const gif = BIRTHDAY_GIFS[Math.floor(Math.random() * BIRTHDAY_GIFS.length)];
      const wish = BIRTHDAY_MESSAGES[Math.floor(Math.random() * BIRTHDAY_MESSAGES.length)];

      const messageBlocks = [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `🎂 *Happy Birthday, ${provider.full_name}!* 🎂\n\n${wish}\n\nPlease join us in wishing *${provider.full_name}* a wonderful birthday! 🎁🎈`,
          },
        },
        {
          type: 'image',
          image_url: gif,
          alt_text: 'Birthday celebration GIF',
        },
      ];

      const response = await fetch(`${GATEWAY_URL}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${LOVABLE_API_KEY}`,
          'X-Connection-Api-Key': SLACK_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: BIRTHDAY_CHANNEL_ID,
          text: `🎂 Happy Birthday, ${provider.full_name}! 🎂`,
          blocks: messageBlocks,
          unfurl_media: true,
          username: 'Birthday Bot 🎂',
          icon_emoji: ':birthday:',
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        console.error(`Failed to send birthday message for ${provider.full_name}:`, data);
      } else {
        sentCount++;
        console.log(`Birthday message sent for ${provider.full_name}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Sent ${sentCount} birthday message(s)`,
        sent: sentCount,
        birthdays: birthdayProviders.map((p) => p.full_name),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in send-birthday-slack:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

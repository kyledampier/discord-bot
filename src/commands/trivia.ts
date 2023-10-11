import { InteractionResponseType, MessageComponentTypes } from "discord-interactions";
import { CommandConfig, DiscordMessage } from "../types";
import { serializeInput } from "../utils/serialize";

export const TriviaConfig: CommandConfig = {
	name: 'trivia',
	description: 'Challenge your friends to a game of trivia!',
	type: 1,
	options: [
		{
			name: 'challenger',
			description: 'The person you want to challenge',
			type: 6, // USER
			required: true,
		},
		{
			name: 'wager',
			description: 'The amount of :coin: you want to wager',
			type: 4, // INTEGER
			required: true,
		},
		{
			name: 'questions',
			description: 'The number of questions you want to ask',
			type: 4, // INTEGER
			required: true,
		},
		{
			name: 'category',
			description: 'The category of questions you want to ask',
			type: 3, // STRING
			required: false,
			choices: [
				{
					name: 'General Knowledge',
					value: 'general',
				},
				{
					name: "Literature",
					value: "literature",
				},
				{
					name: "Movies",
					value: "movies",
				},
				{
					name: "Music",
					value: "music",
				},
				{
					name: "Sports",
					value: "sports",
				}
			]
		}
	],
};

export async function trivia(msg: DiscordMessage, env: Env, ctx: ExecutionContext) {
	const input = serializeInput(TriviaConfig, msg.data.options!);
	if (!input.challenger) {
		return new Response(
			JSON.stringify({
				error: 'Invalid request signature',
			}),
			{
				status: 401,
			}
		);
	}

	const messenger = msg.member?.user.id;
	const challenger = input.challenger as string;
	const interactionUrl = `https://discord.com/api/v10/interactions/${env.DISCORD_APP_ID}/${msg.token}/callback`;

	return new Response(
		JSON.stringify({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: `<@!${messenger}> has challenged <@!${challenger}> to a game of trivia!`,
				components: [
					{
						type: MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: MessageComponentTypes.BUTTON,
								label: 'Accept',
								style: 3, // GREEN
								custom_id: 'challenger_accept',
							},
							{
								type: MessageComponentTypes.BUTTON,
								label: 'Decline',
								style: 4, // RED
								custom_id: 'challenger_decline',
							},
						],
					},
				],
			},
		}),
		{
			headers: {
				'Content-Type': 'application/json',
			},
		}
	);
}

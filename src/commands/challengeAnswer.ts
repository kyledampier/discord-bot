import { eq } from "drizzle-orm";
import { answer_log, challenge, question_log } from "../schema";
import { DiscordMessage } from "../types";
import getDb from "../utils/db";
import { channelMessage, channelMessageWithQuestion, componentACK, getQuestionEmbedAndComponents } from "../utils/response";
import { getChallengeState } from "../utils/states";
import { updateInteraction } from "../utils/updateInteraction";
import { getNewQuestion } from "../utils/newQuestion";
import { shuffleArray } from "../utils/shuffleArray";
import { MessageComponentTypes } from "discord-interactions";

type AnswerChoice = {
	challenge_id: number;
	current_question: number;
	question_id: number;
	answer_id: number;
}

function serializeAnswerChoice(custom_id?: string): AnswerChoice {
	if (!custom_id) {
		throw new Error('Invalid custom_id');
	}

	const [_, challenge_id, current_question, question_id, answer_id] = custom_id.split('-');
	return {
		challenge_id: Number.parseInt(challenge_id),
		current_question: Number.parseInt(current_question),
		question_id: Number.parseInt(question_id),
		answer_id: Number.parseInt(answer_id),
	};
}

export async function challengeAnswer(msg: DiscordMessage, env: Env, ctx: ExecutionContext) {

	const db = getDb(env);
	const answerChoice = serializeAnswerChoice(msg.data.custom_id);
	console.log(answerChoice);
	const state = await getChallengeState(env, answerChoice.challenge_id, answerChoice.question_id, answerChoice.current_question);

	console.log('challenge state', state);

	if (!state) throw new Error('Challenge not found');

	const isInitiator = state.challenge.initiator_id === msg.member?.user.id;
	const isChallenger = state.challenge.challenger_id === msg.member?.user.id;

	if (!(isInitiator || isChallenger)) {
		return componentACK();
	}

	const initiatorAnswered = state.answer_logs.some((a) => a.user_id === state.challenge.initiator_id);
	const challengerAnswered = state.answer_logs.some((a) => a.user_id === state.challenge.challenger_id);

	if (isInitiator && initiatorAnswered) return componentACK();
	if (isChallenger && challengerAnswered) return componentACK();

	const correctAnswer = state.question_logs[0].answer_id;
	const isCorrect = correctAnswer === answerChoice.answer_id;

	// if both have answered, return an ack
	if (initiatorAnswered && challengerAnswered) return componentACK();
	if ((isInitiator && initiatorAnswered) || (isChallenger && challengerAnswered)) return componentACK();

	// if both have not answered yet, update the interaction for the users
	if (!initiatorAnswered && !challengerAnswered) {
		let interactionUpdate: Promise<any> | undefined;
		let questionLogUpdate: Promise<any> | undefined;

		const questionState = await env.STATES.get(`challenge-${answerChoice.challenge_id}-${answerChoice.current_question}`).then((s) => JSON.parse(s ?? "{}"));
		if (!questionState && questionState.answers) throw new Error('Question state not found');

		if (isInitiator) {
			const questionLog = state.question_logs.filter((q) => q.user_id === state.challenge.initiator_id)[0];
			if (!questionLog) throw new Error('Question log not found');

			const { embedQuestion, components } = getQuestionEmbedAndComponents(
				state.question,
				questionState.answers,
				state.challenge,
				{
					initiator: isCorrect ? "correct" : "incorrect",
					challenger: "unanswered",
				},
				false // buttons enabled
			);

			interactionUpdate = updateInteraction(env, questionLog.interaction_token ?? "", {
				embeds: [embedQuestion],
				components: [
					{
						type: MessageComponentTypes.ACTION_ROW,
						components,
					},
				]
			});

			questionLogUpdate = db.update(question_log).set({
				correct: isCorrect,
			}).where(eq(question_log.id, questionLog.id));
		}

		if (isChallenger) {
			const questionLog = state.question_logs.filter((q) => q.user_id === state.challenge.challenger_id)[0];
			if (!questionLog) throw new Error('Question log not found');

			const { embedQuestion, components } = getQuestionEmbedAndComponents(
				state.question,
				questionState.answers,
				state.challenge,
				{
					initiator: "unanswered",
					challenger: isCorrect ? "correct" : "incorrect",
				},
				false // buttons enabled
			);

			interactionUpdate = updateInteraction(env, questionLog.interaction_token ?? "", {
				embeds: [embedQuestion],
				components: [
					{
						type: MessageComponentTypes.ACTION_ROW,
						components,
					},
				]
			});

			questionLogUpdate = db.update(question_log).set({
				correct: isCorrect,
			}).where(eq(question_log.id, questionLog.id));
		}

		const promises = Promise.all([
			interactionUpdate,
			questionLogUpdate,
			db.insert(answer_log).values({
				challenge_id: answerChoice.challenge_id,
				question_id: answerChoice.question_id,
				question_number: answerChoice.current_question,
				guild_id: msg.guild_id ?? "",
				user_id: msg.member?.user.id ?? "",
				answer_id: answerChoice.answer_id,
				interaction_id: msg.id,
				interaction_token: msg.token,
				correct: isCorrect,
			})
		]);

		ctx.waitUntil(promises);
		return componentACK();
	}

	let promises: Promise<any>[] = [];

	const initiatorChallengeLog = state.question_logs.filter((q) => q.user_id === state.challenge.initiator_id)[0];
	if (!initiatorChallengeLog) throw new Error('Question log not found');

	const challengerChallengeLog = state.question_logs.filter((q) => q.user_id === state.challenge.challenger_id)[0];
	if (!challengerChallengeLog) throw new Error('Question log not found');

	let isInitiatorCorrect: boolean = false;
	let isChallengerCorrect: boolean = false;

	if (isInitiator && challengerAnswered) {
		isInitiatorCorrect = isCorrect;
		isChallengerCorrect = challengerChallengeLog.correct ?? false;

		promises.push(db.update(question_log).set({
			correct: isInitiatorCorrect,
		}).where(eq(question_log.id, initiatorChallengeLog.id)));
	}

	if (isChallenger && initiatorAnswered) {
		isInitiatorCorrect = initiatorChallengeLog.correct ?? false;
		isChallengerCorrect = isCorrect;

		promises.push(db.update(question_log).set({
			correct: isChallengerCorrect,
		}).where(eq(question_log.id, challengerChallengeLog.id)));
	}

	const questionState = await env.STATES.get(`challenge-${answerChoice.challenge_id}-${answerChoice.current_question}`).then((s) => JSON.parse(s ?? "{}"));
	if (!questionState && questionState.answers) throw new Error('Question state not found');

	const { embedQuestion, components } = getQuestionEmbedAndComponents(
		state.question,
		questionState.answers,
		state.challenge,
		{
			initiator: isInitiatorCorrect ? "correct" : "incorrect",
			challenger: isChallengerCorrect ? "correct" : "incorrect",
		},
		true // disable buttons
	);

	const interactionUpdate = updateInteraction(env, initiatorChallengeLog.interaction_token ?? "", {
		embeds: [embedQuestion],
		components: [
			{
				type: MessageComponentTypes.ACTION_ROW,
				components,
			},
		]
	});
	promises.push(interactionUpdate);

	const answerLogUpdate = db.insert(answer_log).values({
		challenge_id: answerChoice.challenge_id,
		question_id: answerChoice.question_id,
		question_number: answerChoice.current_question,
		guild_id: msg.guild_id ?? "",
		user_id: msg.member?.user.id ?? "",
		answer_id: answerChoice.answer_id,
		interaction_id: msg.id,
		interaction_token: msg.token,
		correct: isCorrect,
	});
	promises.push(answerLogUpdate);

	let currentQuestionNum = (state.challenge.current_question ?? 0) + 1;

	console.log('currentQuestionNum', currentQuestionNum, 'num_questions', state.challenge.num_questions);

	if (currentQuestionNum < state.challenge.num_questions) {
		// generate a new question
		promises.push(db.update(challenge).set({
			current_question: currentQuestionNum,
		}).where(eq(challenge.id, state.challenge.id)));

		const newQuestion = await getNewQuestion(env, state.challenge.id, currentQuestionNum);

		const questionLogInitiator: typeof question_log.$inferInsert = {
			challenge_id: state.challenge.id,
			question_number: currentQuestionNum,
			question_id: newQuestion.id,
			guild_id: state.challenge.guild_id,
			user_id: state.challenge.initiator_id,
			answer_id: newQuestion.answers.filter((a) => a.correct)[0].id ?? null,
			interaction_id: msg.id,
			interaction_token: msg.token,
		};

		const questionLogChallenger = {
			...questionLogInitiator,
			user_id: state.challenge.challenger_id,
		};

		promises.push(db.insert(question_log).values(questionLogInitiator));
		promises.push(db.insert(question_log).values(questionLogChallenger));

		ctx.waitUntil(Promise.all(promises));
		state.challenge.current_question = currentQuestionNum;
		return channelMessageWithQuestion(newQuestion, newQuestion.answers, state.challenge);
	}

	// end the challenge
	promises.push(db.update(challenge).set({
		current_question: currentQuestionNum,
		status: "completed"
	}).where(eq(challenge.id, state.challenge.id)));

	// TODO: determine winner or tie

	// TODO: update balances

	ctx.waitUntil(Promise.all(promises));
	return channelMessage("Challenge completed!");
}
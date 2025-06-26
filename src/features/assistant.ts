import { ChatHandlerResult, sendChatParticipantRequest } from "@vscode/chat-extension-utils";
import { ChatRequestHandler, ChatRequest, ChatContext, ChatResponseStream, CancellationToken, lm, ChatResult } from "vscode";

export const cfmleditorAssistantHandler: ChatRequestHandler = async (
	request: ChatRequest,
	chatContext: ChatContext,
	stream: ChatResponseStream,
	token: CancellationToken
): Promise<ChatResult | undefined> => {
	if (request.command === "list") {
		stream.markdown(`Available tools: ${lm.tools.map(tool => tool.name).join(", ")}\n\n`);
		return;
	}

	const tools = request.command === "all"
		? lm.tools
		: lm.tools.filter(tool => tool.tags.includes("cfmleditor"));

	let libResult: ChatHandlerResult;
	try {
		libResult = sendChatParticipantRequest(
			request,
			chatContext,
			{
				prompt: "you are an expert cfml developer, answer as an expert cfml developer",
				responseStreamOptions: {
					stream,
					references: true,
					responseText: true,
				},
				tools: tools,
			},
			token
		);
	}
	catch (err) {
		let message = "Unknown error";
		if (err instanceof Error) {
			message = err.message;
		}
		else if (typeof err === "string") {
			message = err;
		}
		throw new Error(`Failed to send chat participant request: ${message}`);
	}

	if (typeof libResult.result !== "object" || typeof libResult.result.then !== "function") {
		throw new Error("Unexpected result type");
	}

	return await libResult.result;
};

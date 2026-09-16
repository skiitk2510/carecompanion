import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import type { Logger } from '../log.js';
import type { ConverseFn } from './bedrockBrain.js';

/** Real Bedrock Converse, region pinned explicitly (the local AWS profile defaults to ap-south-1). */
export function createConverse(region: string, log: Logger): ConverseFn {
  const client = new BedrockRuntimeClient({ region });
  return async (input) => {
    const started = performance.now();
    try {
      const output = await client.send(new ConverseCommand(input));
      log.debug('bedrock converse', {
        stopReason: output.stopReason,
        inputTokens: output.usage?.inputTokens,
        outputTokens: output.usage?.outputTokens,
        ms: Math.round(performance.now() - started),
      });
      return output;
    } catch (err) {
      const name = (err as { name?: string }).name ?? 'Error';
      if (name === 'AccessDeniedException') {
        log.error(
          'Bedrock refused the request — enable model access for the model in the Bedrock console for this region, and check the IAM policy allows bedrock:InvokeModel.',
          { region, model: input.modelId }
        );
      }
      throw err;
    }
  };
}

/** Errors that mean "Bedrock is unusable right now" rather than "this turn went wrong". */
export function isBedrockUnavailable(err: unknown): boolean {
  const name = (err as { name?: string }).name ?? '';
  return [
    'AccessDeniedException',
    // Also raised when the account has not submitted the Anthropic use-case form / enabled model access.
    'ResourceNotFoundException',
    'ThrottlingException',
    'ServiceUnavailableException',
    'ModelNotReadyException',
    'CredentialsProviderError',
    'UnrecognizedClientException',
    'ExpiredTokenException',
  ].includes(name);
}

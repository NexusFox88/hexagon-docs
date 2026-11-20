# Model endpoints

Choose the endpoint's wire protocol in Console → Infrastructure → LLM → Add model endpoint. `anthropic-compatible` serves `/v1/messages`; `openai-compatible` serves `/v1/chat/completions`. `openai-responses` serves `/v1/responses`. A third-party provider can implement one or more of these distinct protocols.

For Chat Completions, use a base such as `https://api.siliconflow.com/v1` or `https://api.openai.com/v1`. Endpoints may omit the final `/v1`; do not include `/chat/completions`. Set the exact provider model ID. Verification makes a bounded model request and may incur provider usage. Providers/models that require a different request contract are not silently translated.

Python:

```python
from hexagon import Hexagon
import os
api = Hexagon.local()
model = api.create_connection(kind='model', provider='openai-compatible',
    name='My Chat Completions endpoint',
    credential=os.environ['MODEL_API_KEY'],
    config={'base_url': 'https://api.siliconflow.com/v1',
            'model': 'deepseek-ai/DeepSeek-V4-Flash'})
checked = api.validate_connection(model['id'])
if checked['status'] != 'ready':
    raise RuntimeError('Model verification failed')
api.update_connection(model['id'], enabled=True)
```

TypeScript:

```ts
const api = await Hexagon.local();
const model = await api.createConnection({kind:'model', provider:'openai-compatible',
  name:'My Chat Completions endpoint', credential:process.env.MODEL_API_KEY,
  config:{base_url:'https://api.siliconflow.com/v1', model:'deepseek-ai/DeepSeek-V4-Flash'}});
const checked = await api.validateConnection(model.id);
if (checked.status !== 'ready') throw new Error('Model verification failed');
await api.updateConnection(model.id, {enabled:true});
```

Supply that connection's ID as `model_connection_id` when creating Sessions. Built-in OpenCode and Pi support all three protocols, as do new OCI registrations for their Runtime protocols. Claude Code, DeepSeek Harness, Aider and example Python image adapters currently remain Messages-only; the catalog does not claim upstream support that Hexagon has not implemented. Existing OCI registrations are immutable: register a new version to obtain updated compatibility metadata.

Model account keys remain in the control plane. A Run-scoped grant reaches the guest (or the provider's native header binding); the external credential listener permits only the configured protocol path, injects the original account key, and streams the response without parsing or converting model messages.

## Responses

Select **OpenAI Responses** in the model catalog, or set `provider='openai-responses'` / `provider: 'openai-responses'` in the examples above. Use your actual Responses-capable base URL and model ID. Do not append `/responses` to the base URL. The key is registered with the same encrypted connection credential flow; validation sends a bounded Responses request with `store:false`.

OpenCode uses its native `@ai-sdk/openai` adapter and Pi uses `openai-responses`. Text streaming, function calls and continuation are tested with actual OCI binaries and a deterministic Responses endpoint. This does not establish real-account compatibility with every endpoint advertising Responses. Server-hosted built-in tools, background job polling, WebSocket mode and automatic protocol conversion are outside this adapter's contract. Harness tool calls use the existing Hexagon tool mailbox and approval flow.

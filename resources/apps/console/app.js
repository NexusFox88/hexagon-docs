import {renderSecretReferences} from './session-security.js';
import {providerIdentity} from './provider-identity.js';
import {pageParent} from './navigation.js';
import {verifySandboxConnection} from './sandbox-connect.js';
import {renderToolUsage} from './tool-usage.js';
import {installListValues} from './list-values.js';
import {installScrollLayout} from './scroll-layout.js';
import {renderMcpEditor,mcpForm} from './mcp-editor.js';
import {openHarnessEditor} from './harness-console.js';
import {openToolCatalog,openConnectionCatalog} from './tool-catalog.js';
import {setLocalWorkspace,localWorkspace} from './local-workspace.js';
import {renderSessionHome,renderSessionExample,renderSessionDetail,renderSettings} from './session-console.js';
import {renderRun} from './run-detail.js';
import {renderTokens} from './tokens.js';
import {renderOverview,renderExecutionList,renderSetup} from './operations.js';
import {renderAgents,renderHarnesses,seedAgentConnection} from './agents.js';
import {renderNetwork,renderOperations} from './infrastructure.js';
import { renderQuickstart, seedSavedAgent, seedSession } from './quickstart.js';
import { t, UiError, formatList, formatNumber, formatDate, formatBytes, getLocale, setLocale, localeOptions } from './i18n.js';
import './icons.js';
import { openModal, closeModal, modalOpen, confirmAction, validateForm, markServerFields } from './components.js';
const $ = id => document.getElementById(id);
installScrollLayout($('content'));
installListValues($('content'));
let token = '', view = 'sandboxes', connections = [], fleet = [], editing = null, selected = null, selectedRun = null, loading = false, refreshPending = false;
const labels = () => ({ paused:t('ui.paused'),pausing:t('ui.pausing'),resuming:t('ui.resuming'), rejected: t("ui.rejected"), runtime_ready: t("ui.ready"), unreachable: t("ui.unreachable_process_state_unknown"), interrupted: t("ui.interrupted_environment_recovery_required"), stopped: t("ui.stopped"), destroyed: t("ui.destroyed"), ready: t("ui.verified"), draft: t("ui.not_verified"), invalid: t("ui.verification_failed"), open: t("ui.open"), closed: t("ui.closed"), closing: t("ui.cleaning_up"), queued: t("ui.queued"), provisioning: t("ui.provisioning"), running: t("ui.running"), waiting_authorization: t("ui.awaiting_authorization"), waiting_approval: t("ui.awaiting_approval"), cancelling: t("ui.cancelling"), cancelled: t("ui.cancelled"), completed: t("ui.completed"), failed: t("ui.failed"), preparing: t("ui.preparing_files"), reserved: t("ui.reserved"), starting: t("ui.starting"), not_started: t("ui.not_started"), unknown: t("ui.unknown") });
const errors = () => ({ sandbox_quota_exceeded: t("ui.sandbox_quota_exceeded"), sandbox_openssh_unavailable: t("ui.sandbox_openssh_unavailable"), secret_in_use: t("ui.this_secret_is_still_referenced_remove_its_connection_references_before"), secret_disabled: t("ui.this_secret_is_disabled_enable_it_in_secrets_then_verify"), credential_proxy_not_configured: t("ui.configure_an_https_credential_proxy_endpoint_before_creating_a_session"), session_connection_changed: t("ui.the_connection_or_secret_has_changed_create_a_new_session"), sandbox_creation_unconfirmed: t("ui.creation_is_unconfirmed_the_original_resource_will_be_reconciled_without"), sandbox_deletion_unconfirmed: t("ui.resource_deletion_is_unconfirmed_retry_cleanup_to_reconcile_the_provider"), unauthorized: t("ui.the_api_token_is_invalid_or_revoked_connect_again"), connection_in_use: t("ui.this_connection_is_in_use_close_its_sessions_before_deleting"), validation_required: t("ui.verify_the_current_configuration_and_credentials_before_enabling_this_connection"), invalid_request: t("ui.check_the_input_fields_and_configuration_format"), session_busy: t("ui.this_session_has_active_runs_cancel_them_and_wait_for"), connection_changed_during_validation: t("ui.the_configuration_changed_during_verification_verify_it_again"), active_run: t("ui.finish_the_active_run_first") });
const errorKeys = {
 sandbox_image_preparation_unconfirmed:'errors.image_preparation_unconfirmed',
 sandbox_image_build_pending:'errors.image_build_pending',
 sandbox_image_build_failed:'errors.image_build_failed',
 sandbox_image_deleted:'errors.image_deleted',
 sandbox_image_contract_incomplete:'errors.image_contract_incomplete',
 model_authentication_failed:'errors.model_authentication_failed',model_rate_limited:'errors.model_rate_limited',model_request_failed:'errors.model_request_failed',model_transport_failed:'errors.model_transport_failed',
 harness_initialization_unsupported:'errors.harness_initialization_unsupported',
 agent_revision_not_found:'errors.agent_revision_not_found',
 initialization_too_large:'errors.initialization_too_large',
 context_file_missing:'errors.context_file_missing',
 context_file_changed:'errors.context_file_changed',
 context_file_too_large:'errors.context_file_too_large',
 context_file_encoding:'errors.context_file_encoding',
 input_too_large:'errors.input_too_large',
 reserved_initialization_path:'errors.reserved_initialization_path',

 session_paused:'ui.session_paused_help',
 session_transition_pending:'ui.pause_pending_help',
 session_pause_scope_conflict:'ui.pause_scope_conflict',
 sandbox_pause_unsupported:'ui.pause_unsupported',
 sandbox_checkpoint_unconfirmed:'ui.checkpoint_unknown',
 sandbox_checkpoint_missing:'ui.checkpoint_missing',
 sandbox_restore_unconfirmed:'ui.restore_unknown',

    'invalid_image_reference': 'ui.oci_error_invalid_image_reference',
    'image_not_found': 'ui.oci_error_image_not_found',
    'image_registry_request_failed': 'ui.oci_error_image_registry_request_failed',
    'image_registry_authentication_failed': 'ui.oci_error_image_registry_authentication_failed',
    'image_platform_unsupported': 'ui.oci_error_image_platform_unsupported',
    'image_digest_mismatch': 'ui.oci_error_image_digest_mismatch',
    'harness_entrypoint_missing': 'ui.oci_error_harness_entrypoint_missing',
    'harness_version_conflict': 'ui.oci_error_harness_version_conflict',
    'sandbox_oci_image_unsupported': 'ui.oci_error_sandbox_oci_image_unsupported',
    'sandbox_private_image_unsupported': 'ui.oci_error_sandbox_private_image_unsupported',
    'image_registry_credential_invalid': 'ui.oci_error_image_registry_credential_invalid',

    credential_proxy_tunnel_unavailable:'ui.credential_auto_failed',credential_ingress_unreachable:'ui.credential_auto_failed',credential_ingress_recovery_blocked:'ui.credential_recovery_blocked',
    owner_token_required:'ui.owner_token_required',application_token_not_found:'ui.application_token_not_found',
    agent_revision_changed:'ui.agent_revision_changed',agent_archived:'ui.agent_archived',agent_not_found:'ui.agent_not_found',
    deployment_configuration_changed: 'ui.deployment_configuration_changed',
    deployment_configuration_busy: 'ui.deployment_configuration_busy',
    deployment_configuration_invalid: 'ui.deployment_configuration_invalid',
    deployment_management_forbidden: 'ui.deployment_management_forbidden',
    resource_review_required: 'ui.resource_review_required',
    resource_reconciliation_scheduled: 'ui.resource_reconciliation_scheduled',
    resource_operation_not_pending: 'ui.resource_operation_not_pending',
    development_ingress_disabled: 'ui.development_ingress_disabled',
    resource_operation_not_found: 'ui.resource_operation_not_found',

    app_oauth_setup_required: 'ui.app_oauth_setup_required',
    app_permission_denied: 'ui.app_permission_denied',
    app_permission_or_request_rejected:'ui.app_permission_denied',
    mcp_discovery_failed:'ui.mcp_discovery_failed',
    mcp_schema_changed:'ui.mcp_schema_changed',
    mcp_connection_failed:'ui.mcp_connection_failed',
    harness_runtime_prerequisites_unavailable:'ui.harness_runtime_prerequisites_unavailable',
    app_rate_limited: 'ui.app_rate_limited',
    app_oauth_state_invalid: 'ui.app_auth_failed',
    app_request_rejected: 'ui.app_request_rejected',

    sandbox_quota_exceeded: "ui.sandbox_quota_exceeded",
    sandbox_openssh_unavailable: "ui.sandbox_openssh_unavailable",
    "secret_in_use": "ui.this_secret_is_still_referenced_remove_its_connection_references_before",
    "secret_disabled": "ui.this_secret_is_disabled_enable_it_in_secrets_then_verify",
    "credential_proxy_not_configured": "ui.configure_an_https_credential_proxy_endpoint_before_creating_a_session",
    "session_connection_changed": "ui.the_connection_or_secret_has_changed_create_a_new_session",
    "sandbox_creation_unconfirmed": "ui.creation_is_unconfirmed_the_original_resource_will_be_reconciled_without",
    "sandbox_deletion_unconfirmed": "ui.resource_deletion_is_unconfirmed_retry_cleanup_to_reconcile_the_provider",
    "unauthorized": "ui.the_api_token_is_invalid_or_revoked_connect_again",
    "connection_in_use": "ui.this_connection_is_in_use_close_its_sessions_before_deleting",
    "validation_required": "ui.verify_the_current_configuration_and_credentials_before_enabling_this_connection",
    "invalid_request": "ui.check_the_input_fields_and_configuration_format",
    "session_busy": "ui.this_session_has_active_runs_cancel_them_and_wait_for",
    "connection_changed_during_validation": "ui.the_configuration_changed_during_verification_verify_it_again",
    "active_run": "ui.finish_the_active_run_first"
};
const previewGrants = new Map();
let savedAgents = [];
let applicationCatalog = [], oauthClients = [], ingressState, executionCatalog = { harnesses: [] };
let secretRows = [], editingSecret = null, editorSecrets = [];
const formErrors = new Map();
function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined)
        node.textContent = text;
    if (className)
        node.className = className;
    return node;
}
function button(text, action, className = '') {
    const b = el('button', text, className);
    b.type = 'button';
    b.onclick = async () => {
        b.disabled = true;b.setAttribute('aria-busy','true');
        try {
            await action();
        }
        catch (e) {
            noticeError(e);
        }
        finally {
            b.disabled = false;b.removeAttribute('aria-busy');
        }
    };
    return b;
}
function compactActions(actions, name, visible = 2) {
    const overflow = [...actions.children].slice(visible);
    if (!overflow.length)
        return actions;
    const menu = el('div', undefined, 'action-menu'), trigger = el('button', '···'), panel = el('div', undefined, 'menu-panel');
    trigger.type = 'button';
    trigger.setAttribute('aria-label', t("ui.more_actions_name", { name: name }));
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    panel.setAttribute('role', 'menu');
    panel.setAttribute('aria-label', t("ui.actions_for_name", { name: name }));
    const close = () => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
    for (const action of overflow) {
        action.setAttribute('role', 'menuitem');
        action.tabIndex = -1;
        const click = action.onclick;
        action.onclick = event => { close(); trigger.focus(); return click(event); };
        panel.append(action);
    }
    trigger.onclick = () => {
        const opening = panel.hidden;
        document.querySelectorAll('.menu-panel').forEach(node => { node.hidden = true; node.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
        if (opening) {
            panel.hidden = false;
            const bounds = trigger.getBoundingClientRect();
            const height = panel.offsetHeight;
            panel.style.left = `${Math.max(12, Math.min(innerWidth - 182, bounds.right - 170))}px`;
            panel.style.top = `${Math.max(12, bounds.bottom + height + 5 > innerHeight - 12 ? bounds.top - height - 5 : bounds.bottom + 5)}px`;
            trigger.setAttribute('aria-expanded', 'true');
            panel.querySelector('button:not(:disabled)')?.focus();
        }
    };
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close();
            trigger.focus();
        }
        if (event.key === 'Tab') {
            trigger.focus();
            close();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            if (panel.hidden) {
                trigger.click();
                return;
            }
            const items = [...panel.querySelectorAll('button:not(:disabled)')];
            const index = items.indexOf(document.activeElement);
            items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
        }
    });
    menu.append(trigger, panel);
    actions.append(menu);
    return actions;
}
document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.action-menu').forEach(menu => {
        if (!menu.contains(event.target)) {
            menu.querySelector('.menu-panel').hidden = true;
            menu.querySelector('button').setAttribute('aria-expanded', 'false');
        }
    });
});
document.addEventListener('scroll', event => {
    if (event.target instanceof Element && event.target.closest('.menu-panel'))
        return;
    document.querySelectorAll('.menu-panel').forEach(panel => { panel.hidden = true; panel.previousElementSibling?.setAttribute('aria-expanded', 'false'); });
}, true);
let noticeTimer, noticeState;
function paintNotice() {
    const root = $('notice');
    root.replaceChildren(el('span', typeof noticeState.text === 'function' ? noticeState.text() : noticeState.text));
    const dismiss = button('×', () => { root.hidden = true; }, 'icon-button');
    dismiss.setAttribute('aria-label', t('ui.dismiss_notification'));
    root.append(dismiss);
    root.className = noticeState.error ? 'error' : '';
    root.setAttribute('role', noticeState.error ? 'alert' : 'status');
    root.hidden = false;
}
function notice(text, error = false) { clearTimeout(noticeTimer); noticeState = { text, error }; paintNotice(); if (!error)
    noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 6000); }
function errorText(error) { return error instanceof UiError ? error.message : t('ui.the_operation_could_not_be_completed_try_again'); }
function noticeError(error) { notice(() => errorText(error), true); }
function showFormError(id, error) { formErrors.set(id, error); $(id).textContent = errorText(error); $(id).hidden = false; }
function apiError(code) { const key = errorKeys[code]; return new UiError(key || 'ui.request_failed_code', key ? {} : { code }); }
function stateLabel(state) { return labels()[state] || t('ui.unknown_state_code', { code: state }); }
function eventLabel(type) {
    const key = eventKeys[type];
    if (key)
        return t(key);
    if (type.startsWith('run.') && labels()[type.slice(4)])
        return t('ui.run_state', { state: stateLabel(type.slice(4)) });
    return t('ui.execution_record');
}
const eventKeys = {
    'model.response':'ui.model_request_recorded',
    'agent.initialized':'ui.agent_initialized',
    'harness.running':'ui.simple_harness_running','tool.completed':'ui.simple_tool_completed',
    'run.claimed': 'ui.run_claimed_by_worker', 'run.recovery_needed': 'ui.run_awaiting_reconciliation', 'runtime.reconnected': 'ui.runtime_reconnected',
    'sandbox.image_building':'ui.image_building', 'workspace.inputs_verified': 'ui.input_files_verified', 'approval.required': 'ui.approval_required', 'approval.decided': 'ui.approval_decision_recorded',
    'agent.activity.started':'ui.harness_activity_started','agent.activity.completed':'ui.harness_activity_completed','agent.message':'ui.harness_message','agent.message.delta':'ui.harness_message',
    'authorization.required': 'ui.authorization_required', 'authorization.denied': 'ui.authorization_denied', 'harness.stdout': 'ui.agent_output',
    'harness.starting': 'ui.harness_starting', 'harness.exited': 'ui.harness_exited', 'runtime.interrupted': 'ui.runtime_interrupted',
};
function badge(state) { return el('span', stateLabel(state), `badge state-${state} ${state==='ready'?'good':state==='invalid'?'bad':''}`); }
async function api(method, path, body, headers = {}) {
    let response;
    try {
        const send=()=>fetch(`/v1${path}`, { method, headers: { ...headers, Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
        response=await send();
        if(response.status===401&&localWorkspace()){
            const bootstrap=await fetch('/local/connect',{method:'POST',headers:{'X-Hexagon-Local':'1'},credentials:'same-origin',redirect:'error'});
            if(bootstrap.ok){const grant=await bootstrap.json();if(grant.mode==='local'&&grant.token){token=grant.token;setLocalWorkspace(grant.data_directory);response=await send();}}
        }
    }
    catch {
        throw new UiError('ui.unable_to_reach_the_service_check_your_connection_and_try');
    }
    if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        const code = error.error?.code || `HTTP ${response.status}`;
        const problem=apiError(code);problem.httpStatus=response.status;problem.fields=error.error?.fields;throw problem;
    }
    return response.status === 204 ? null : response.json();
}
function table(headings) { const wrap = el('div', undefined, 'table-wrap dense-table'), t = el('table'), head = el('thead'), row = el('tr'), body = el('tbody'); headings.forEach(text => {const th=el('th',text);th.scope='col';row.append(th);}); head.append(row); t.append(head, body); wrap.append(t); return { wrap, body }; }
function cell(...children) { const td = el('td'); td.append(...children); return td; }
function identity(name, sub) { const node = el('div'); node.append(el('strong', name), el('div', sub, 'secondary')); return node; }
function connectionIdentity(connection) { const node = el('div'); node.append(button(connection.name, () => openEditor(connection), 'name-button'), el('div', `${connection.provider} · v${connection.version}`, 'secondary')); return node; }
function empty(title, text) { const node = el('div', undefined, 'empty'); node.append(el('h2', title), el('p', text)); return node; }
function paintIngress() { $('ingress-status').textContent = ingressState === 'reachable' ? t('ui.credential_proxy_operational') : t('ui.credential_access_on_demand'); }
let lastRefresh;
async function refresh() {
    if (!token)
        return;
    if (loading) {
        refreshPending = true;
        return;
    }
    loading = true;
    $('content').setAttribute('aria-busy','true');$('refresh').setAttribute('aria-busy','true');
    const requested = view, requestedHash=location.hash;
    try {
        const health = await api('GET', '/health');
        if(view!==requested||location.hash!==requestedHash)return;
        ingressState = health.credential_access?.state;
        paintIngress();
        if(requested==='tools'&&new URLSearchParams(requestedHash.split('?')[1]??'').has('id')){await renderToolUsage($('content'),new URLSearchParams(requestedHash.split('?')[1]).get('id'),api);}
        else if (['sandboxes', 'tools', 'http', 'models'].includes(requested)) {
            const [configured,catalog,apps]=await Promise.all([api('GET','/connections'),api('GET','/catalog'),api('GET','/applications')]);connections=configured.connections;executionCatalog=catalog;applicationCatalog=apps.applications;oauthClients=apps.oauth_clients;
            if (view === requested && location.hash===requestedHash)
                renderConnections();
        }
        else if(requested==='settings'){renderSettings($('content'));}
        else if (requested==='tokens'){const data=await api('GET','/tokens');if(view===requested&&location.hash===requestedHash)renderTokens($('content'),data,api,refresh,noticeError);}
        else if (requested==='overview') {const data=await api('GET','/overview');if(view===requested&&location.hash===requestedHash)renderOverview($('content'),data,health);}
        else if (requested==='setup') {const [configured,agents,completed]=await Promise.all([api('GET','/connections'),api('GET','/agents'),api('GET','/runs?state=completed&limit=1')]);if(view===requested&&location.hash===requestedHash)renderSetup($('content'),health,configured.connections,agents.agents,completed.runs);}
        else if(requested==='sessions'){
            const query=new URLSearchParams(requestedHash.split('?')[1]??'');
            if(query.has('id'))await renderSessionDetail($('content'),query.get('id'),{api,showRun,isCurrent:()=>view===requested&&location.hash===requestedHash});
            else{const [data,configured]=await Promise.all([api('GET',`/sessions?${query}`),api('GET','/connections')]);if(view===requested&&location.hash===requestedHash)renderSessionHome($('content'),data,configured.connections,api);}
        }
        else if (['runs','pending'].includes(requested)) {
            const query=new URLSearchParams(location.hash.split('?')[1]??'');
            if(requested==='runs'&&query.has('id')){await showRun(query.get('id'),$('content'));}
            else {const data=await api('GET',`/${requested}?${query}`);if(view===requested&&location.hash===requestedHash)renderExecutionList($('content'),requested,data,api,noticeError);}
        }
        else if (requested === 'agents'||requested==='harnesses') {
            const [catalog,configured,agents]=await Promise.all([api('GET','/catalog'),api('GET','/connections'),api('GET','/agents')]);
            if(view===requested&&location.hash===requestedHash){if(requested==='agents')renderAgents($('content'),agents.agents,configured.connections,catalog,api,refresh,noticeError);else renderHarnesses($('content'),catalog,api,refresh,noticeError);}
        }
        else if (requested === 'network') {
            const saved=await api('GET','/deployment');
            if(view===requested&&location.hash===requestedHash)renderNetwork($('content'),saved,health,api,noticeError);
        }
        else if (requested === 'operations') {
            const data=await api('GET','/resource-operations');
            if(view===requested&&location.hash===requestedHash)renderOperations($('content'),data,api,refresh,noticeError);
        }
        else if (requested === 'quickstart') {
            const [configured, catalog] = await Promise.all([api('GET', '/connections'), api('GET', '/catalog')]);
            connections = configured.connections; executionCatalog = catalog;
            if (view === requested && location.hash===requestedHash) {if(new URLSearchParams(location.hash.split('?')[1]).has('agent')){const saved=await api('GET','/agents');if(location.hash===requestedHash)renderQuickstart($('content'),connections,executionCatalog,health?.credential_access?.state,saved.agents);}else await renderSessionExample($('content'),connections,executionCatalog,health?.credential_access?.state,api);}
        }
        else if (requested === 'secrets') {
            const [managed,configured]=await Promise.all([api('GET','/secrets'),api('GET','/connections')]);secretRows=managed.secrets;connections=configured.connections;
            if (view === requested && location.hash===requestedHash)
                renderSecrets();
        }
        else {
            fleet = (await api('GET', '/fleet')).sessions;
            if (view === requested && location.hash===requestedHash) {
                renderFleet();
                if (selected)
                    await detail(selected);
            }
        }
        lastRefresh=new Date();$('refresh-stale')?.remove();
    }
    catch (e) {
        if($('content').querySelector('.loading-state')){$('content').replaceChildren(el('p',t('ui.refresh_failed'),'inline-error'),button(t('ui.refresh_retry'),refresh));}
        if(lastRefresh){const stale=el('p',t('ui.refresh_stale',{date:formatDate(lastRefresh)}),'hint');stale.id='refresh-stale';$('refresh-stale')?.remove();$('content').prepend(stale);}
        $('ingress-status').textContent = t("ui.unable_to_refresh_endpoint_status_check_the_control_plane_connection");
        noticeError(e);
    }
    finally {
        $('content').setAttribute('aria-busy','false');
        loading = false;$('refresh').removeAttribute('aria-busy');
        if (token && (view !== requested || refreshPending)) {
            refreshPending = false;
            refresh();
        }
    }
}
function connectionNextStep(c){return !c.has_credential&&!(c.provider==='mcp-remote'&&c.config.authentication==='none')?'ui.next_credentials':c.status==='invalid'?'ui.next_repair':c.status!=='ready'?'ui.next_verify':!c.enabled?'ui.next_enable':'ui.walk_connection_ready';}
function filterProviders(){const count=$('provider').filter($('provider-search').value);$('provider-no-matches').hidden=count>0;}
function openAgentFromConnection(connection){location.hash='quickstart';}
$('navigation-toggle').onclick=()=>{const open=$('navigation-toggle').getAttribute('aria-expanded')!=='true';$('navigation-toggle').setAttribute('aria-expanded',String(open));$('main-navigation').classList.toggle('mobile-open',open);};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('navigation-toggle').getAttribute('aria-expanded')==='true'&&!modalOpen()){event.preventDefault();$('navigation-toggle').click();$('navigation-toggle').focus();}});
$('provider-search').oninput = filterProviders;
$('provider-search').onkeydown = event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if ($('provider').list.hidden) $('provider').toggle(); }
};
let appCategory='';
function renderConnections() {
    const root = $('content');
    root.replaceChildren();
    const scoped = connections.filter(c => c.kind === pages()[view].kind);
    const shown = scoped.filter(c => matchesSearch(c.name + ' ' + c.provider) && ($('status-filter').value === 'all' || ($('status-filter').value === 'ready' ? c.enabled && c.status === 'ready' : !c.enabled || c.status !== 'ready')));
    const ready=kind=>connections.some(c=>c.kind===kind&&c.enabled&&c.status==='ready');
    const missing=!ready('sandbox')?'sandbox':!ready('model')?'model':null;

    if (!shown.length) {
        root.append(empty(scoped.length ? t("ui.no_matching_connections") : t("ui.add_your_first_kind", { kind: kindTitles()[pages()[view].kind] }), scoped.length ? t("ui.try_a_different_search_or_status_filter") : pages()[view].subtitle));
        return;
    }
    const { wrap, body } = table([t("ui.dense_connection"),t(pages()[view].kind==='model'?'ui.model_protocol':'ui.provider'),t("ui.dense_config"),t("ui.dense_status"),t("ui.credentials"),t("ui.dense_verified"),t("ui.actions")]);
    for (const c of shown) {
        const actions = el('div', undefined, 'row-actions');
        actions.append(button(t("ui.copy_id"), async () => {
            try {
                await navigator.clipboard.writeText(c.id);
                notice(() => t("ui.connection_id_copied"));
            }
            catch {
                notice(() => t("ui.connection_id_id", { id: c.id }));
            }
        }), button(t("ui.configure"), () => openEditor(c)), button(t("ui.verify"), async () => { const row = await api('POST', `/connections/${c.id}/validate`); notice(() => row.status === 'ready' ? t("ui.verification_passed_you_can_enable_this_connection") : row.validation?.code === 'sandbox_openssh_unavailable' ? t("ui.sandbox_openssh_unavailable") : row.validation?.code === 'credential_required' ? t("ui.enter_access_credentials_first") : t("ui.verification_failed_check_the_credentials_endpoint_and_permissions"), row.status !== 'ready'); await refresh(); }));
        const toggle = button(c.enabled ? t("ui.disable") : t("ui.enable"), async () => { await api('PATCH', `/connections/${c.id}`, { enabled: !c.enabled }); notice(() => c.enabled ? t("ui.connection_disabled_existing_resources_can_still_be_cleaned_up") : t("ui.connection_enabled")); await refresh(); });
        toggle.disabled = !c.enabled && c.status !== 'ready';
        if(c.kind==='tool'&&c.has_credential)actions.append(button(t('ui.crm_disconnect'),async()=>{if(!await confirmAction(()=>t('ui.crm_disconnect_confirm',{name:c.name})))return;await api('POST',`/connections/${c.id}/disconnect`);notice(()=>t('ui.crm_disconnected'));await refresh();},'danger'));
        actions.append(toggle, button(t(missing==='model'&&c.kind==='sandbox'?'ui.walk_add_model':missing==='sandbox'&&c.kind==='model'?'ui.walk_add_sandbox':'ui.simple_api'), () => {if(missing&&c.kind!==missing){location.hash=missing==='model'?'models':'sandboxes';}else openAgentFromConnection(c);}));
        const nextAction = c.status === 'ready' && c.enabled ? actions.children[1] : c.status === 'ready' ? toggle : c.status === 'invalid' || (!c.has_credential&&!(c.provider==='mcp-remote'&&c.config.authentication==='none')) ? actions.children[1] : actions.children[2];
        actions.prepend(nextAction);
        if(c.kind==='tool')actions.prepend(button(t('ui.tool_usage'),()=>{location.hash=`tools?id=${c.id}`;}));
        actions.append(button(t("ui.delete"), async () => {
            if (!await confirmAction(() => t("ui.delete_connection_name_this_does_not_delete_the_provider_account", { name: c.name })))
                return;
            await api('DELETE', `/connections/${c.id}`);
            notice(() => t("ui.connection_deleted"));
            await refresh();
        }, 'danger'));
        const state = el('div');const availability=badge(c.status);if(c.status==='ready'){availability.textContent=t(c.enabled?'ui.ready':'ui.connection_paused');availability.classList.toggle('good',c.enabled);}state.append(availability);
        if(c.kind==='tool'&&c.validation?.permission_coverage==='partial')state.append(el('small',t('ui.crm_partial'),'secondary'));
        if(c.status==='invalid')state.append(el('small',t(connectionNextStep(c)),'secondary'));
        const config=el('div');if(c.kind==='model'){config.append(el('span',c.config?.model??'—'));if(c.config?.base_url)try{config.append(el('small',new URL(c.config.base_url).host,'secondary'));}catch{}}
        else if(c.kind==='tool'){const application=applicationCatalog.find(a=>a.id===c.provider);config.append(el('span',application?t(`ui.category_${application.category}`):t(c.provider==='mcp-remote'?'ui.mcp_remote':'ui.catalog_custom')));if(c.validation?.account)config.append(el('small',String(c.validation.account),'secondary'));}
        else config.append(el('span',c.config?.region??c.config?.template??c.config?.project_id??'—'));
        const name=el('div');name.append(button(c.name,()=>{if(c.kind==='tool')location.hash=`tools?id=${c.id}`;else openEditor(c);},'name-button'),el('code',c.id,'secondary'));
        body.append(el('tr'));body.lastChild.id=`connection-row-${c.id}`;
        body.lastChild.append(cell(name),cell(providerIdentity(c.provider,applicationCatalog)),cell(config),cell(state),cell(el('span',c.provider==='mcp-remote'&&c.config.authentication==='none'?t('ui.table_no_auth'):c.has_credential?t('ui.saved'):t('ui.not_configured'),'secondary')),cell(el('span',c.validation?.checked_at?formatDate(c.validation.checked_at):'—','secondary')),cell(compactActions(actions,c.name,1)));
    }
    wrap.classList.add('connection-table');root.append(wrap);
}
function field(id, label, value = '', type = 'text', help = '') {
    const wrapper = el('div'), l = el('label', label), input = el(type === 'textarea' ? 'textarea' : 'input');
    l.htmlFor = id;
    input.id = id;
    input.value = value;
    if (type !== 'textarea')
        input.type = type === 'number' ? 'text' : type;
    if (type === 'number') {
        input.inputMode = 'numeric';
        input.dataset.numeric = 'true';
    }
    input.autocomplete = 'off';
    wrapper.append(l, input);
    if (help)
        wrapper.append(el('p', help, 'hint'));
    $('provider-fields').append(wrapper);
    return input;
}
function providerFields(config = {}) {
    $('provider-fields').replaceChildren();$('sandbox-credentials').replaceChildren();$('sandbox-required').replaceChildren();$('sandbox-setup').replaceChildren();$('connection-auth-method').replaceChildren();$('sandbox-credentials').hidden=false;$('sandbox-secret-choice').hidden=false;
    const kind = $('kind').value;
    const providerLabel=document.querySelector('label[for=provider] [data-i18n]'),providerKey=kind==='model'?'ui.model_protocol':'ui.provider';
    providerLabel.dataset.i18n=providerKey;providerLabel.textContent=t(providerKey);$('provider').dataset.i18nAriaLabel=providerKey;$('provider').setAttribute('aria-label',t(providerKey));
    if(kind==='sandbox'){
      const declared=executionCatalog.connections?.find(c=>c.kind==='sandbox'&&c.provider===$('provider').value);
      if(declared){
        if(declared.setup_url){const setup=el('a',t('ui.integration_setup_link'));setup.href=declared.setup_url;setup.target='_blank';setup.rel='noopener noreferrer';$('provider-fields').append(setup);}
        const info=el('details',undefined,'provider-capabilities');info.append(el('summary',t('ui.provider_capabilities')),el('p',t('ui.integration_sandbox_permissions'),'hint'));
        for(const capability of ['preview','network_allowlist'])info.append(el('p',t(`ui.integration_capability_${capability}`,{state:t(declared.capabilities.includes(capability)?'ui.ready':'ui.integration_unsupported')}),'hint'));
        info.append(el('p',t('ui.integration_pause_expiry'),'hint'));$('provider-fields').append(info);
      }
    }
    const isModal = kind === 'sandbox' && $('provider').value === 'modal';
    const hasCredentialFields = kind === 'tool' && Boolean(applicationCatalog.find(app => app.id === $('provider').value)?.credential_fields?.length);
    $('credential').hidden = isModal || hasCredentialFields;
    document.querySelector('label[for=credential]').hidden = isModal || hasCredentialFields;
    $('credential-hint').textContent = editing?.has_credential ? t("ui.credentials_saved_leave_blank_to_keep_them_credential_or_configuration") : t('ui.connection_credential_next');
    if (isModal) {
        field('modal-token-id', t("ui.modal_token_id"), '', 'password');
        field('modal-token-secret', t("ui.modal_token_secret"), '', 'password', t("ui.enter_both_credentials_when_connecting_or_replacing_credentials"));
        $('modal-token-id').autocomplete = 'new-password';
        $('modal-token-secret').autocomplete = 'new-password';
    }
    if (kind === 'sandbox' && $('provider').value === 'instabox')
        field('instabox-template', t('ui.sandbox_template'), config.template || 'agent-browser', 'text', t('ui.instabox_connection_help'));
    if (kind === 'sandbox' && $('provider').value === 'e2b')
        field('template', t("ui.sandbox_template"), config.template || 'base', 'text', t("ui.opencode_requires_a_template_with_at_least_2_gib_of"));
    if (kind === 'sandbox' && $('provider').value === 'daytona') {
        field('api-url', t("ui.daytona_api_url"), config.api_url || 'https://app.daytona.io/api', 'url');
        field('snapshot', t("ui.snapshot_must_meet_harness_resource_requirements"), config.snapshot || '');
        field('target', t("ui.target_region_optional"), config.target || '');
    }
    if (kind === 'sandbox' && $('provider').value === 'modal') {
        field('modal-app', t("ui.modal_app"), config.app || 'hexagon');
        field('modal-image', t("ui.container_image"), config.image || 'python:3.12-slim');
        field('modal-memory', t("ui.memory_mib"), String(config.memory_mb || 2048), 'number');
        field('modal-region', t("ui.region_optional"), config.region || '');
    }
    if (kind === 'sandbox' && $('provider').value === 'fly-machines') {
        field('fly-organization', t("ui.organization_slug"), config.organization || 'personal');
        field('fly-region', t("ui.region"), config.region || 'iad', 'text', t("ui.each_session_gets_a_separate_app_and_private_network_with"));
    }
    if (kind === 'sandbox' && $('provider').value === 'boat')
        field('boat-size', t("ui.instance_size"), config.size || 'small', 'text', t("ui.sizes_small_default_large_maximum_file_size_5_mib_expiry"));
    if (kind === 'sandbox' && $('provider').value === 'freestyle')
        field('freestyle-snapshot', t("ui.base_snapshot"), config.snapshot || 'freestyle/ubuntu-sm', 'text', t("ui.freestyle_ubuntu_sm_2_vcpu_4_gib_freestyle_ubuntu_4"));
    if (kind === 'sandbox' && $('provider').value === 'agent37')
        field('agent37-region', t("ui.region"), config.region || 'us', 'text', t("ui.regions_us_eu_base_image_2_vcpu_4_gib_persistent"));
    if (kind === 'sandbox' && $('provider').value === 'vercel') {
        field('vercel-project', t("ui.vercel_project_id"), config.project_id || '');
        field('vercel-team', t("ui.vercel_team_id"), config.team_id || '');
        field('vercel-cpus', 'vCPU', String(config.vcpus || 2), 'number', t("ui.credentials_need_sandbox_access_to_this_team_project_provider_expiry"));
    }
    if (kind === 'sandbox' && $('provider').value === 'upstash')
        field('upstash-size', t("ui.instance_size"), config.size || 'small', 'text', t("ui.sizes_small_medium_large_provider_ttl_is_requested_control_plane"));
    if (kind === 'sandbox' && $('provider').value === 'sprites') {
        field('sprites-memory', t("ui.memory_mib"), String(config.memory_mb || 2048), 'number');
        field('sprites-cpus', 'CPU', String(config.cpus || 2), 'number', t("ui.the_control_plane_deletes_expired_persistent_instances_resources_may_remain"));
    }
    if (kind === 'sandbox' && $('provider').value === 'blaxel') {
        field('blaxel-workspace', t("ui.blaxel_workspace"), config.workspace || '');
        field('blaxel-image', t("ui.sandbox_image"), config.image || 'blaxel/base-image:latest');
        field('blaxel-memory', t("ui.memory_mib"), String(config.memory_mb || 2048), 'number');
        field('blaxel-region', t("ui.region_optional"), config.region || '');
    }
    if (kind === 'model') {
        $('provider-fields').append(el('p',t($('provider').value==='openai-responses'?'ui.responses_help':$('provider').value==='openai-compatible'?'ui.catalog_openai_help':'ui.catalog_anthropic_help'),'hint'));
        field('base-url', t("ui.model_api_url"), config.base_url || '', 'url');
        field('model-name', t("ui.model_name"), config.model || '');$('base-url').required=true;$('model-name').required=true;$('base-url').placeholder=$('provider').value==='anthropic-compatible'?'https://api.anthropic.com':'https://api.openai.com/v1';$('model-name').placeholder=t('ui.connect_model_placeholder');
    }
    if(kind==='tool'&&$('provider').value==='mcp-remote')renderMcpEditor($('provider-fields'),config,field,()=>{credentialMode();paintIntegrationAuth();});
    if (kind === 'http') {
        field('http-endpoint', t("ui.https_endpoint"), config.endpoint || '', 'url');
        field('http-auth-header', t("ui.authentication_header_leave_blank_for_bearer"), config.authentication?.type === 'header' ? config.authentication.name : '');
        field('http-rules', t("ui.allowed_requests_exact_paths_and_methods_json"), JSON.stringify(config.access?.rules || [{ methods: ['POST'], path: '/search' }], null, 2), 'textarea');
    }
    if (kind === 'tool' && !['http-json','mcp-remote'].includes($('provider').value)) {
        applicationFields(config);
    }
    if (kind === 'tool' && $('provider').value === 'http-json') {
        field('base-url', t("ui.service_url"), config.base_url || '', 'url');
        field('verify-path', t("ui.credential_verification_path"), config.verify_path || '/auth/check');
        field('operations', t("ui.tool_operations_json"), JSON.stringify(config.operations || { read: { path: '/requirements', method: 'GET', description: t("ui.read_requirements"), input_schema: { type: 'object', properties: {}, additionalProperties: false } } }, null, 2), 'textarea', t("ui.define_operation_names_paths_parameters_and_approval_requirements_use_approval"));
    }
}
const connectionBodyOrder=[...document.querySelector('#connection-form .dialog-body').children];
function layoutSandboxEditor(){
 const body=document.querySelector('#connection-form .dialog-body');body.append(...connectionBodyOrder);
 const sandbox=$('kind').value==='sandbox',provider=$('provider').value;
 $('editor').classList.add('connection-onboarding');$('editor').classList.toggle('sandbox-editor',sandbox);$('sandbox-advanced').open=!sandbox;
 if(!sandbox){layoutIntegrationEditor();return;}
 $('sandbox-advanced').querySelector('summary').textContent=t('ui.sandbox_advanced');
 const name=providers().sandbox.find(([id])=>id===provider)?.[1]??provider;
 body.append($('form-error'),$('kind'),$('provider-search-group'),document.querySelector('label[for=provider]'),$('provider'),document.querySelector('label[for=credential]'),$('credential'),$('sandbox-credentials'),$('sandbox-setup'),$('credential-hint'),$('sandbox-secret-choice'),$('sandbox-required'),document.querySelector('label[for=name]'),$('name'),$('sandbox-advanced'),$('connection-auth-heading'));
 $('editor-title').textContent=t(editing?'ui.sandbox_edit_title':'ui.sandbox_connect_title',{provider:name});
 $('editor-description').textContent=t('ui.sandbox_connect_description');
 $('editor-scope').textContent=name;
 const icon=document.createElement('img');icon.className='sandbox-provider-icon';icon.alt='';icon.src=`/console/brands/${provider}.${({e2b:'png',instabox:'svg',freestyle:'png',agent37:'ico'})[provider]??'svg'}`;
 $('editor-scope').prepend(icon);
 for(const id of ['modal-token-id','modal-token-secret'])if($(id))$('sandbox-credentials').append($(id).parentElement);
 for(const id of ['vercel-project','vercel-team','blaxel-workspace'])if($(id))$('sandbox-required').append($(id).parentElement);
 const setup=$('provider-fields').querySelector('a');if(setup){setup.textContent=t('ui.sandbox_get_credentials');$('sandbox-setup').append(setup);}
 $('credential').placeholder=t('ui.sandbox_credential_placeholder');
 $('sandbox-secret-choice').open=Boolean($('secret-reference').value);
 $('credential-hint').textContent=t(editing?.has_credential?'ui.sandbox_credential_saved':'ui.sandbox_credential_help');
 const submit=$('connection-form').querySelector('.dialog-footer button[type=submit]');submit.textContent=t('ui.sandbox_verify_connect');
 document.querySelector('#editor .footer-help').textContent=t('ui.sandbox_connect_footer');
 const template=$('instabox-template')??$('template');if(template){const hint=template.parentElement.querySelector('.hint');if(hint)hint.textContent=t('ui.sandbox_template_help');}
}
function layoutIntegrationEditor(){
 const kind=$('kind').value,provider=$('provider').value,app=applicationCatalog.find(a=>a.id===provider),root=$('provider-fields'),body=document.querySelector('#connection-form .dialog-body');
 const name=providers()[kind].find(([id])=>id===provider)?.[1]??provider;
 $('editor-title').textContent=t(editing?'ui.sandbox_edit_title':'ui.sandbox_connect_title',{provider:name});
 $('editor-description').textContent=t(kind==='model'?'ui.connect_model_description':provider==='mcp-remote'?'ui.connect_mcp_description':kind==='http'?'ui.connect_http_description':'ui.connect_tool_description');
 $('editor-scope').textContent=name;
 const icon=document.createElement('img');icon.alt='';icon.className='sandbox-provider-icon';const brand=kind==='model'?(provider==='anthropic-compatible'?'claude':'openai'):provider;
 icon.src=`/console/brands/${brand}.${({feishu:'png',lark:'png',exa:'png',readwise:'png',firecrawl:'png'})[brand]??'svg'}`;if(kind!=='http')$('editor-scope').prepend(icon);
 body.append($('form-error'),$('kind'),$('provider-search-group'),document.querySelector('label[for=provider]'),$('provider'),$('connection-auth-method'),document.querySelector('label[for=credential]'),$('credential'),$('sandbox-credentials'),$('sandbox-setup'),$('credential-hint'),$('sandbox-secret-choice'),$('sandbox-required'),document.querySelector('label[for=name]'),$('name'),$('sandbox-advanced'),$('connection-auth-heading'));
 const moveField=(id,target=$('sandbox-required'))=>{if(!$(id))return;const parent=$(id).parentElement;if(parent===root){const label=root.querySelector(`label[for="${id}"]`);if(label)target.append(label);target.append($(id));}else target.append(parent);};
 for(const id of ['app-authentication','mcp-auth'])moveField(id,$('connection-auth-method'));
 for(const input of root.querySelectorAll('[data-app-credential]'))$('sandbox-credentials').append(input.parentElement);
 const link=root.querySelector('a');if(link)$('sandbox-setup').append(link);
 for(const id of ['app-instance-url','base-url','model-name','mcp-endpoint','mcp-header','app-region','http-endpoint','http-rules','operations'])moveField(id);
 if(app){
  for(const element of [...root.children]){
   if(element.hasAttribute('data-app-oauth')||element.classList.contains('tool-permissions')||element.classList.contains('connection-charge'))$('sandbox-required').append(element);
  }
  $('sandbox-required').querySelectorAll('button[data-app-oauth]').forEach(button=>button.classList.add('onboarding-redundant-action'));
 }
 const mcpTools=$('mcp-tools');if(mcpTools&&mcpTools.querySelector('[data-mcp-tool]'))$('sandbox-required').append(mcpTools);
 const discover=root.querySelector('[data-mcp-discover]');if(discover)discover.remove();
 // A redundant API description stays out of the first step; advanced transport/rules remain editable.
 const advancedKey=root.querySelector('input,textarea,hx-select,details')?'ui.sandbox_advanced':'ui.connect_details';$('sandbox-advanced').querySelector('summary').textContent=t(advancedKey);
 $('sandbox-advanced').open=false;
 const permissions=$('sandbox-required').querySelector('[data-permission-editor]');if(permissions){const update=()=>{const selected=permissions.querySelectorAll('[data-app-operation]:checked').length,total=permissions.querySelectorAll('[data-app-operation]').length;permissions.querySelector('summary').textContent=t('ui.connect_permissions_count',{selected:formatNumber(selected),total:formatNumber(total)});};permissions.open=!permissions.querySelector('[data-app-operation]:checked');permissions.addEventListener('change',update);update();}
 $('sandbox-secret-choice').open=Boolean($('secret-reference').value);
 $('credential').placeholder=t('ui.connect_credential_placeholder');
 $('credential-hint').textContent=t(editing?.has_credential?'ui.sandbox_credential_saved':'ui.sandbox_credential_help');
 paintIntegrationAuth();
}
function paintIntegrationAuth(){
 const provider=$('provider').value,kind=$('kind').value;if(kind==='sandbox')return;
 const oauth=$('app-authentication')?.value==='oauth',anonymous=provider==='mcp-remote'&&$('mcp-auth').value==='none';
 const multi=Boolean(document.querySelector('[data-app-credential]'));
 $('credential').hidden=oauth||anonymous||multi;document.querySelector('label[for=credential]').hidden=$('credential').hidden;
 $('sandbox-credentials').hidden=oauth||anonymous;$('sandbox-secret-choice').hidden=oauth||anonymous;
 document.querySelectorAll('[data-app-oauth]').forEach(node=>node.hidden=!oauth);
 const discover=provider==='mcp-remote'&&!document.querySelector('[data-mcp-tool]');
 $('connection-form').querySelector('.dialog-footer button[type=submit]').textContent=t(oauth?'ui.connect_continue_oauth':discover?'ui.mcp_discover':'ui.sandbox_verify_connect');
 document.querySelector('#editor .footer-help').textContent=t(oauth?'ui.connect_oauth_footer':discover?'ui.connect_mcp_footer':kind==='model'?'ui.connect_model_footer':'ui.sandbox_connect_footer');
 if(anonymous)$('credential-hint').textContent=t('ui.mcp_no_credential');else if(oauth)$('credential-hint').textContent=t('ui.connect_oauth_footer');else $('credential-hint').textContent=t(editing?.has_credential?'ui.sandbox_credential_saved':'ui.sandbox_credential_help');
}

function renderApplicationVerification(root,validation){
 const section=el('details',undefined,'tool-permissions');section.append(el('summary',t('ui.crm_verification')));
 section.append(el('p',t('ui.crm_local_permissions'),'hint'));
 if(validation.account)section.append(el('p',t('ui.crm_account',{account:validation.account})));
 section.append(el('p',validation.scope_source==='provider'?t('ui.crm_scopes',{scopes:(validation.scope||[]).join(', ')}):t('ui.crm_scopes_unknown'),'hint'));
 for(const check of validation.permission_checks||[]){const row=el('p',undefined,'hint');row.append(el('code',check.operation),document.createTextNode(' · '+t(`ui.crm_permission_${check.state}`)));section.append(row);}
 if(validation.code)section.append(el('p',t('ui.crm_validation_error',{code:validation.code}),'hint'));
 root.append(section);
}
function applicationFields(config) {
    const app = applicationCatalog.find(item => item.id === $('provider').value);
    if (!app) return;
    const root = $('provider-fields');
    if (app.oauth) {
        const label = el('label', t('ui.app_authentication')); label.htmlFor = 'app-authentication';
        const mode = el('hx-select'); mode.id = 'app-authentication'; mode.setOptions([{value:'api_key',label:t('ui.app_api_key')},{value:'oauth',label:t('ui.app_oauth_title')}]); mode.value = config.authentication || 'api_key';
        mode.onchange = () => { document.querySelectorAll('[data-app-oauth]').forEach(node => node.hidden = mode.value !== 'oauth'); credentialMode();paintIntegrationAuth(); }; root.append(label,mode);
    }
    const link = el('a', t('ui.app_get_credentials')); link.href = app.credential_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    root.append(link, el('p', t('ui.app_credentials_help'), 'hint'));
    for (const definition of app.credential_fields || []) {
        const input = field(`app-credential-${definition.name}`, t(definition.label_key), '', 'password'); input.dataset.appCredential = definition.name; input.autocomplete = 'new-password';
    }
    if (app.credential_fields?.length) root.append(el('p', t('ui.app_multi_credential_help'), 'hint'));
    if(['feishu','lark'].includes(app.id))root.append(el('p',t('ui.lark_setup_help'),'hint'));
    if(app.id==='salesforce')field('app-instance-url',t('ui.crm_instance'),config.instance_url||'','url',t('ui.crm_instance_help'));
    if(['hubspot','salesforce','attio'].includes(app.id))root.append(el('p',t('ui.crm_validation_help'),'hint'));
    if(editing?.validation)renderApplicationVerification(root,editing.validation);
    if(editing?.authorization){const auth=editing.authorization;root.append(el('p',t(`ui.crm_auth_${auth.state}`),'hint'));if(auth.expires_at)root.append(el('p',t('ui.crm_expires',{time:formatDate(auth.expires_at)}),'hint'));}
    if (app.verification_may_charge) root.append(el('p', t('ui.app_verify_charge'), 'hint connection-charge'));
    if (app.id === 'deepl') {
        const label = el('label', t('ui.app_deepl_plan')); label.htmlFor = 'app-region';
        const region = el('hx-select'); region.id = 'app-region'; region.setOptions([{value:'free',label:'DeepL API Free'},{value:'paid',label:'DeepL API Pro'}]); region.value = config.region || 'free'; root.append(label,region);
    }
    const group = el('fieldset', undefined, 'app-operations'); group.append(el('legend', t('ui.app_operations')));
    group.append(el('p', t('ui.app_operations_help'), 'hint'));
    for (const op of app.operations) {
        const label = el('label', undefined, 'app-operation'); const input = el('input'); input.type = 'checkbox'; input.id = `app-op-${op.name}`; input.dataset.appOperation = op.name; input.checked = config.operations ? config.operations.includes(op.name) : !op.write;
        const text = el('span'); text.append(el('span', t(`app.operation.${op.name}`)), el('small', `${op.name} · ${t(op.write ? 'ui.app_approval_required' : 'ui.app_read_only')}`, 'secondary')); label.append(input,text); group.append(label);
    }
    const operations=el('details',undefined,'tool-permissions');operations.dataset.permissionEditor='';operations.append(el('summary',t('ui.app_operations')),group);root.append(operations);
    if (app.oauth) {
        const before = new Set(root.children);
        const setup = oauthClients.find(item => item.provider === app.id);
        const section = el('div', undefined, 'app-oauth'); section.append(el('h3', t('ui.app_oauth_title')), el('p', t('ui.app_oauth_help'), 'hint')); root.append(section);
        field('app-client-id', t('ui.app_client_id'), setup?.client_id || '');
        field('app-client-secret', t('ui.app_client_secret'), '', 'password');
        field('app-redirect', t('ui.app_redirect'), setup?.redirect_uri || `${location.origin}/oauth/callback`, 'url', t('ui.app_redirect_help'));
        root.append(button(t('ui.app_save_oauth'), async () => {
            if (!$('app-client-id').value || !$('app-client-secret').value) throw new UiError('ui.app_client_required');
            await api('PUT', `/applications/${app.id}/oauth-client`, {client_id:$('app-client-id').value,client_secret:$('app-client-secret').value,redirect_uri:$('app-redirect').value});
            $('app-client-secret').value = ''; oauthClients = (await api('GET','/applications')).oauth_clients; notice(() => t('ui.app_oauth_saved'));
        }));
        if (editing) root.append(button(t('ui.app_authorize'), () => authorizeApplication(editing.id)));
        for (const node of root.children) if (!before.has(node)) { node.dataset.appOauth = ''; node.hidden = $('app-authentication').value !== 'oauth'; }
    }
}
async function authorizeApplication(id) {
    if (editing && JSON.stringify(editing.config.operations || []) !== JSON.stringify([...document.querySelectorAll('[data-app-operation]:checked')].map(input => input.dataset.appOperation))) throw new UiError('ui.app_save_permissions');
    if(document.querySelector('.app-auth-progress[data-pending]'))return;
    const flow = await api('POST', `/connections/${id}/authorize`);
    const root = $('sandbox-required');
    root.querySelector('.app-auth-progress')?.remove();
    const panel = el('div', undefined, 'app-auth-progress');
    const link = el('a', t('ui.app_open_authorization')); link.href = flow.authorization_url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    const status = el('p', t('ui.app_auth_pending'), 'hint');
    panel.dataset.pending='true';
    let stopped = false;
    panel.append(el('p',t('ui.connect_authorization_next'),'hint'),link, status, button(t('ui.app_cancel_authorization'), async () => { await api('DELETE', `/authorization-flows/${flow.id}`); stopped = true;delete panel.dataset.pending; status.textContent = t('ui.app_auth_cancelled'); })); root.append(panel); link.focus();
    const poll = async () => {
        if (stopped || !panel.isConnected || !modalOpen('editor')) return;
        try {
            const result = await api('GET', `/authorization-flows/${flow.id}`);
            if (result.status === 'pending') { status.textContent = t('ui.app_auth_pending'); setTimeout(poll, 1500); return; }
            delete panel.dataset.pending;status.textContent = t(result.status === 'completed' ? 'ui.app_auth_complete' : result.status === 'cancelled' ? 'ui.app_auth_cancelled' : 'ui.app_auth_failed');
            if (result.status === 'completed') { await refresh(); editing = await api('GET', `/connections/${id}`); notice(() => t('ui.app_auth_complete'));closeModal('editor'); }
        } catch (error) { status.textContent = errorText(error); setTimeout(poll, 3000); }
    }; setTimeout(poll, 1500);
}
let sandboxCreationUncertain=false;
const providers = () => ({
    sandbox: [['e2b', 'E2B'], ['modal', 'Modal'], ['boat', 'Boat'], ['instabox', 'Instabox'], ['vercel', 'Vercel Sandbox'], ['blaxel', 'Blaxel'], ['sprites', 'Fly Sprites'], ['upstash', 'Upstash Box'], ['agent37', 'Agent37'], ['fly-machines', 'Fly Machines'], ['freestyle', 'Freestyle VMs']],
    tool: [...applicationCatalog.map(app => [app.id, app.name]), ['mcp-remote',t('ui.mcp_remote')], ['http-json', t("ui.http_json_tool")]], http: [['http', t("ui.http_credential_access")]], model: [['openai-responses',t('ui.responses_endpoint')], ['openai-compatible', t('ui.openai_compatible_endpoint')], ['anthropic-compatible', t("ui.anthropic_compatible_endpoint")]],
});
function changeKind() { $('provider').setOptions(providers()[$('kind').value].map(([value, label]) => ({ value, label }))); providerFields(); }
async function openEditor(connection = null,preferredProvider=null) {
    const catalog = await api('GET', '/applications');
    applicationCatalog = catalog.applications; oauthClients = catalog.oauth_clients;
    const stored = (await api('GET', '/secrets')).secrets;
    editorSecrets = stored;
    $('secret-reference').hidden=!stored.length;document.querySelector('label[for=secret-reference]').hidden=!stored.length;
    $('secret-reference').setOptions([{ value: '', label: t("ui.enter_credentials_directly") }, ...stored.filter(secret => secret.enabled || secret.id === connection?.secret_id).map(secret => ({ value: secret.id, label: secret.name }))]);
    if(connection?.kind==='tool')connection={...connection,authorization:await api('GET',`/connections/${connection.id}/authorization`)};
    editing = connection;sandboxCreationUncertain=false;
    $('provider-search').value = '';
    $('provider-search-group').hidden = !!connection||!!preferredProvider||pages()[view]?.kind==='model'||pages()[view]?.kind==='http';
    $('provider-no-matches').hidden = true;
    $('form-error').hidden = true;
    formErrors.delete('form-error');
    $('connection-form').reset();
    const kind = connection?.kind || pages()[view].kind;
    $('editor-title').textContent = connection ? t("ui.configure_kind", { kind: kindTitles()[kind] }) : t("ui.add_kind", { kind: kindTitles()[kind] });
    $('editor-scope').textContent = ['sandbox','model'].includes(kind) ? t('ui.simple_runtime') : t("ui.agent_integration");
    $('editor-description').textContent = kind === 'sandbox' ? t("ui.configure_the_connection_used_by_the_platform_to_manage_cloud") : t("ui.configure_the_connection_used_by_agents_to_call_external_services");
    $('kind').disabled = !!connection;
    $('provider').disabled = !!connection||!!preferredProvider;
    $('editor').classList.remove('sandbox-editor');
    $('kind').value = connection?.kind || pages()[view].kind;
    changeKind();
    if (connection)
        $('provider').value = connection.provider;
    else if(preferredProvider)$('provider').value=preferredProvider;
    $('name').value = connection?.name || '';
    $('name').placeholder = t('ui.connection_name_example', { kind: kindTitles()[kind] });
    providerFields(connection?.config || {});
    $('credential-hint').textContent = connection?.has_credential ? t("ui.credentials_saved_leave_blank_to_keep_them_new_credentials_or") : t('ui.connection_credential_next');
    $('secret-reference').value = connection?.secret_id || '';
    credentialMode();
    if(connection){const dependencies=await api('GET',`/connections/${connection.id}/dependencies`);const group=el('details');group.append(el('summary',t('ui.integration_dependencies',{agents:formatNumber(dependencies.agents.length),sessions:formatNumber(dependencies.sessions.length)})));for(const agent of dependencies.agents){const link=el('a',agent.name);link.href=`#agents?id=${agent.id}`;link.onclick=()=>closeModal('editor');group.appendChild(el('p')).append(link);}for(const session of dependencies.sessions){const link=el('a',session.id);link.href=`#fleet?session=${session.id}`;link.onclick=()=>closeModal('editor');group.appendChild(el('p')).append(link);}$('provider-fields').append(group);}
    if(!connection)$('name').value=providers()[kind].find(([id])=>id===$('provider').value)?.[1]??$('provider').value;
    $('connection-form').querySelector('.dialog-footer button[type=submit]').textContent=t('ui.save_configuration');document.querySelector('#editor .footer-help').textContent=t('ui.verify_and_enable_after_saving');
    layoutSandboxEditor();openModal('editor');
}
function credentialMode() {
    const oauth = $('kind').value === 'tool' && $('app-authentication')?.value === 'oauth';
    const anonymous=$('provider').value==='mcp-remote'&&$('mcp-auth')?.value==='none';
    $('secret-reference').disabled = oauth||anonymous;
    if(anonymous){$('secret-reference').value='';$('credential').value='';}
    if($('mcp-header'))$('mcp-header').parentElement.hidden=$('mcp-auth')?.value!=='header';
    const referenced = oauth || anonymous || Boolean($('secret-reference').value);
    for (const id of ['credential', 'modal-token-id', 'modal-token-secret', ...[...document.querySelectorAll('[data-app-credential]')].map(input => input.id)])
        if ($(id)) {
            $(id).disabled = referenced;
            if (referenced)
                $(id).value = '';
        }
    if(anonymous)$('credential-hint').textContent=t('ui.mcp_no_credential');
    else if (oauth) $('credential-hint').textContent = t('ui.app_oauth_credentials');
    else if (referenced)
        $('credential-hint').textContent = t("ui.using_a_saved_secret_rotate_or_disable_it_in_secrets");
}
$('secret-reference').onchange = credentialMode;
$('kind').onchange = changeKind;
$('provider').onchange = () => { providerFields(); credentialMode(); };
$('connection-form').onsubmit = async (event) => {
    event.preventDefault();
    const submit = event.submitter;
    submit.disabled = true;submit.setAttribute('aria-busy','true');
    $('form-error').hidden = true;
    formErrors.delete('form-error');
    try {
        validateForm($('connection-form'));
        const kind = $('kind').value;
        let config = { ...(editing?.config || {}) };
        if (kind === 'sandbox' && $('provider').value === 'e2b')
            config.template = $('template').value;
        if (kind === 'sandbox' && $('provider').value === 'daytona') {
            config = { api_url: $('api-url').value, ...($('snapshot').value ? { snapshot: $('snapshot').value } : {}), ...($('target').value ? { target: $('target').value } : {}) };
        }
        if (kind === 'sandbox' && $('provider').value === 'modal')
            config = { app: $('modal-app').value, image: $('modal-image').value, memory_mb: Number($('modal-memory').value), cpu: editing?.config?.cpu || 2, ...($('modal-region').value ? { region: $('modal-region').value } : {}) };
        if (kind === 'sandbox' && $('provider').value === 'fly-machines')
            config = { organization: $('fly-organization').value, region: $('fly-region').value };
        if (kind === 'sandbox' && $('provider').value === 'boat')
            config = { size: $('boat-size').value };
        if (kind === 'sandbox' && $('provider').value === 'freestyle')
            config = { snapshot: $('freestyle-snapshot').value };
        if (kind === 'sandbox' && $('provider').value === 'instabox')
            config = { template: $('instabox-template').value };
        if (kind === 'sandbox' && $('provider').value === 'agent37')
            config = { region: $('agent37-region').value };
        if (kind === 'sandbox' && $('provider').value === 'vercel')
            config = { project_id: $('vercel-project').value, team_id: $('vercel-team').value, vcpus: Number($('vercel-cpus').value) };
        if (kind === 'sandbox' && $('provider').value === 'upstash')
            config = { size: $('upstash-size').value };
        if (kind === 'sandbox' && $('provider').value === 'sprites')
            config = { memory_mb: Number($('sprites-memory').value), cpus: Number($('sprites-cpus').value) };
        if (kind === 'sandbox' && $('provider').value === 'blaxel')
            config = { workspace: $('blaxel-workspace').value, image: $('blaxel-image').value, memory_mb: Number($('blaxel-memory').value), ...($('blaxel-region').value ? { region: $('blaxel-region').value } : {}) };
        if (kind === 'http')
            config = { endpoint: $('http-endpoint').value, authentication: $('http-auth-header').value ? { type: 'header', name: $('http-auth-header').value } : { type: 'bearer' }, access: { rules: JSON.parse($('http-rules').value) } };
        if (kind === 'model')
            Object.assign(config, { base_url: $('base-url').value, model: $('model-name').value });
        if (kind === 'tool' && !['http-json','mcp-remote'].includes($('provider').value)) {
            config = {authentication: $('app-authentication')?.value || 'api_key', operations: [...document.querySelectorAll('[data-app-operation]:checked')].map(input => input.dataset.appOperation), ...($('app-region') ? {region: $('app-region').value} : {}),...($('app-instance-url')?{instance_url:$('app-instance-url').value}:{})};
            if (!config.operations.length) throw new UiError('ui.app_select_operation');
        }
        if (kind === 'tool' && $('provider').value === 'http-json')
            Object.assign(config, { base_url: $('base-url').value, verify_path: $('verify-path').value, operations: JSON.parse($('operations').value) });
        if(kind==='tool'&&$('provider').value==='mcp-remote'){config=mcpForm();if(editing&&(config.endpoint!==editing.config.endpoint||config.transport!==editing.config.transport))config.tools={};}
        let credential = $('credential').hidden ? '' : $('credential').value;
        const credentialFields = [...document.querySelectorAll('[data-app-credential]')];
        if (credentialFields.some(input => input.value)) {
            if (credentialFields.some(input => !input.value)) throw new UiError('ui.app_multi_credential_required');
            credential = JSON.stringify(Object.fromEntries(credentialFields.map(input => [input.dataset.appCredential, input.value])));
        }
        if (kind === 'sandbox' && $('provider').value === 'modal') {
            const token_id = $('modal-token-id').value, token_secret = $('modal-token-secret').value;
            if (Boolean(token_id) !== Boolean(token_secret))
                throw new UiError("ui.enter_both_the_modal_token_id_and_token_secret");
            credential = token_id ? JSON.stringify({ token_id, token_secret }) : '';
        }
        if (editing?.secret_id && !$('secret-reference').value && !credential && $('app-authentication')?.value !== 'oauth' && !($('provider').value==='mcp-remote'&&config.authentication==='none'))
            throw new UiError("ui.enter_new_access_credentials_when_switching_away_from_a_secret");
        if(!editing?.has_credential&&!credential&&!$('secret-reference').value&&$('app-authentication')?.value!=='oauth'&&!($('provider').value==='mcp-remote'&&config.authentication==='none'))throw new UiError('ui.sandbox_credential_required');
        if($('app-authentication')?.value==='oauth'){
          const setup=oauthClients.find(c=>c.provider===$('provider').value);
          if($('app-client-secret').value){await api('PUT',`/applications/${$('provider').value}/oauth-client`,{client_id:$('app-client-id').value,client_secret:$('app-client-secret').value,redirect_uri:$('app-redirect').value});$('app-client-secret').value='';oauthClients=(await api('GET','/applications')).oauth_clients;}
          else if(!setup||setup.client_id!==$('app-client-id').value||setup.redirect_uri!==$('app-redirect').value)throw new UiError('ui.app_client_required');
        }
        const body = { name: $('name').value, ...(!editing || JSON.stringify(config) !== JSON.stringify(editing.config) ? { config } : {}), ...(!($('app-authentication')?.value === 'oauth') && $('secret-reference').value ? ($('secret-reference').value !== editing?.secret_id ? { secret_id: $('secret-reference').value } : {}) : (credential ? { credential } : {})) };
        if(!editing&&sandboxCreationUncertain)throw new UiError('ui.sandbox_create_uncertain');
        if(!editing)sandboxCreationUncertain=true;
        const saved = editing ? await api('PATCH', `/connections/${editing.id}`, body) : await api('POST', '/connections', { ...body, kind, provider: $('provider').value });
        if(kind==='sandbox'){sandboxCreationUncertain=false;editing=saved;$('credential').value='';for(const id of ['modal-token-id','modal-token-secret'])if($(id))$(id).value='';
          await verifySandboxConnection(api,saved,row=>{editing=row;});closeModal('editor');notice(()=>t('ui.sandbox_connected'));await refresh();return;
        }
        sandboxCreationUncertain=false;editing=saved;
        if($('app-authentication')?.value==='oauth'){await authorizeApplication(saved.id);return;}
        if(saved.provider==='mcp-remote'&&(submit.dataset.mcpDiscover||!Object.keys(config.tools).length)){editing=saved;const discovered=await api('POST',`/connections/${saved.id}/discover-mcp`);await refresh();await openEditor(discovered);notice(()=>t('ui.mcp_discovered'));return;}
        $('credential').value='';document.querySelectorAll('[data-app-credential]').forEach(input=>input.value='');
        await verifySandboxConnection(api,saved,row=>{editing=row;},'ui.connect_verify_failed');
        closeModal('editor');notice(()=>t('ui.connect_ready'));await refresh();
    }
    catch (e) {
        if(e.httpStatus&&e.httpStatus<500)sandboxCreationUncertain=false;
        if(!editing&&sandboxCreationUncertain)e=new UiError('ui.sandbox_create_uncertain');
        markServerFields($('connection-form'),e.fields,{name:'name','config.base_url':'base-url','config.model':'model-name','config.endpoint':'http-endpoint','config.project_id':'vercel-project','config.team_id':'vercel-team','config.vcpus':'vercel-cpus','config.template':'template','config.memory_mb':'blaxel-memory','secret_id':'secret-reference'});
        showFormError('form-error', e instanceof SyntaxError ? new UiError('ui.the_configuration_is_not_valid_json') : e);
        $('form-error').hidden = false;document.querySelector('#editor .dialog-body').scrollTop=0;
    }
    finally {
        submit.disabled = false;submit.removeAttribute('aria-busy');
    }
};
for (const id of ['dismiss', 'cancel-edit'])
    $(id).onclick = () => { $('credential').value = ''; closeModal('editor'); };
$('editor').addEventListener('close', () => {
    $('credential').value = '';
    document.querySelectorAll('[data-app-credential]').forEach(input => input.value = '');
    for (const id of ['modal-token-id', 'modal-token-secret', 'app-client-secret'])
        if ($(id))
            $(id).value = '';
});
function renderFleet() {
    const root = $('content');
    root.replaceChildren();
    if (!fleet.length) {
        root.append(empty(t("ui.ready_for_your_first_session"), t("ui.create_a_session_and_submit_a_task_using_the_python")));
        return;
    }
    const { wrap, body } = table([t("ui.session"), t("ui.harness"), t("ui.sandbox"), t("ui.latest_run"), t("ui.actions")]);
    for (const session of fleet.filter(session => matchesSearch(session.id + ' ' + session.sandbox?.id + ' ' + session.definition.harness?.id) && ($('status-filter').value === 'all' || ($('status-filter').value === 'ready' ? ['open', 'closed'].includes(session.state) && !['failed', 'waiting_authorization', 'waiting_approval'].includes(session.latest_run?.state) : ['failed', 'waiting_authorization', 'waiting_approval'].includes(session.latest_run?.state) || session.state === 'closing')))) {
        const row = el('tr');
        row.append(cell(identity(session.id, stateLabel(session.state))), cell(identity(session.definition.harness?.id || '—', session.definition.harness?.version || '')), cell(identity(session.sandbox?.id || t("ui.not_allocated"), session.sandbox?.state ? stateLabel(session.sandbox.state) : '—')), cell(badge(session.latest_run?.state || 'not_started')), cell(button(t("ui.view_details"), async () => {
            location.hash = `fleet?session=${encodeURIComponent(session.id)}`;
        })));
        body.append(row);
    }
    if (!body.children.length) {
        root.append(empty(t("ui.no_matching_sessions"), t("ui.try_a_different_search_or_status_filter")));
        return;
    }
    root.append(wrap, el('div', undefined, 'detail-slot'));
    root.lastChild.id = 'detail';
}
async function detail(id) {
    const session = fleet.find(s => s.id === id)??await api('GET',`/sessions/${id}`);
    const runs = (await api('GET', `/sessions/${id}/runs`)).runs;
    if (view !== 'fleet' || selected !== id)
        return;
    let root = $('detail');
    if (!root) {root=el('div');root.id='detail';$('content').append(root);}
    root.className = 'detail';
    if(selected){$('content').querySelector('.table-wrap')?.remove();}
    root.replaceChildren();
    const head = el('div', undefined, 'detail-head'), title = el('div');
    title.append(el('h2', t("ui.execution_session")), el('div', id, 'secondary'));
    head.append(title);
    if (session.state !== 'closed')
        head.append(button(session.state === 'closing' ? t("ui.retry_cleanup") : t("ui.close_session"), async () => {
            if (!await confirmAction(() => t("ui.close_this_session_and_clean_up_its_cloud_resources_exported")))
                return;
            await api('POST', `/sessions/${id}/close`);
            notice(() => t("ui.session_closed"));
            await refresh();
        }));
    $('title').textContent=session.definition.name||t('ui.execution_session');
    title.replaceChildren(el('code',id,'secondary'));
    root.append(head);
    const states = el('div', undefined, 'states');
    for (const [label, state] of [[t("ui.sandbox_last_recorded_state"), session.sandbox?.state || 'not_started'], [t("ui.runtime"), session.runtime_state || 'not_started'], [t("ui.run"), runs[0]?.state || 'not_started']]) {
        const box = el('div');
        box.append(el('p', label), badge(label === t("ui.runtime") && state === 'ready' ? 'runtime_ready' : state));
        states.append(box);
    }
    root.append(states);
    for (const operation of session.resource_operations || []) {
        const name=t(({create:'ui.create_resource',delete:'ui.delete_resource',image_prepare:'ui.image_prepare_resource',checkpoint:'ui.checkpoint_resource',restore:'ui.restore_resource'})[operation.kind]??'ui.resource_operation');
        const status = operation.state === 'rejected' ? t("ui.rejected") : ['completed','deleted'].includes(operation.state) ? t("ui.confirmed") : operation.state === 'unknown' ? t("ui.outcome_unknown_reconciliation_pending") : t("ui.in_progress");
        root.append(el('p', `${name} · ${status}${operation.reason ? ' · ' + (errors()[operation.reason] || errors()['sandbox_' + operation.reason] || operation.reason) : ''}`, operation.state === 'unknown' ? 'error' : 'hint'));
    }
    if (session.state === 'open' && session.sandbox?.id && !session.definition.capabilities?.includes('preview'))
        root.append(el('p', t("ui.this_execution_configuration_does_not_support_web_previews"), 'hint'));
    if (session.state === 'open' && session.sandbox?.id && session.definition.capabilities?.includes('preview')) {
        const preview = el('div', undefined, 'actions'), port = el('input');
        port.type = 'text';
        port.inputMode = 'numeric';
        port.min = '3000';
        port.max = '8999';
        port.value = '3000';
        port.setAttribute('aria-label', t("ui.preview_service_port"));
        port.style.width = '110px';
        preview.append(el('span', t("ui.web_preview_port"), 'hint'), port, button(t("ui.create_preview_link"), async () => {
            if (!/^\d+$/.test(port.value) || Number(port.value) < 3000 || Number(port.value) > 8999)
                throw new UiError("ui.the_preview_port_must_be_an_integer_between_3000_and");
            const grant = await api('POST', `/sessions/${id}/previews`, { port: Number(port.value), ttl_seconds: 600 });
            previewGrants.set(id, [...(previewGrants.get(id) || []), grant]);
            drawGrant(grant);
        }));
        function drawGrant(grant) {
            const open = el('a', t("ui.open_preview"));
            open.href = grant.url;
            open.target = '_blank';
            open.rel = 'noopener noreferrer';
            const group = el('div', undefined, 'actions');
            group.append(open, el('span', t("ui.expires_at_time", { time: formatDate(grant.expires_at, true) }), 'hint'), button(t("ui.revoke_link"), async () => { await api('DELETE', `/previews/${grant.id}`); previewGrants.set(id, (previewGrants.get(id) || []).filter(item => item.id !== grant.id)); group.remove(); notice(() => t("ui.preview_link_revoked")); }));
            preview.append(group);
        }
        for (const grant of previewGrants.get(id) || [])
            if (new Date(grant.expires_at).getTime() > Date.now())
                drawGrant(grant);
        root.append(preview);
    }
    if (!runs.length) {
        root.append(el('p', t("ui.no_runs_submitted_yet"), 'hint'));
        return;
    }
    const select = el('hx-select');
    select.setAttribute('aria-label', t("ui.select_run"));
    select.setOptions(runs.map(run => ({ value: run.id, label: `${run.id.slice(0, 8)} · ${stateLabel(run.state)} · ${formatDate(run.created_at)}` })));
    if (selectedRun && runs.some(run => run.id === selectedRun))
        select.value = selectedRun;
    const runContent = el('div');
    select.onchange = () => { selectedRun = select.value; showRun(select.value, runContent).catch(e => noticeError(e)); };
    root.append(select, runContent);
    await showRun(select.value, runContent);
}
async function showRun(id,root,options={}){const hash=location.hash;return renderRun(id,root,{isCurrent:()=>location.hash===hash,api,el,badge,button,refresh,apiError,UiError,token,formatBytes,openEditor,confirmAction,notice,eventLabel,...options});}

const kindTitles = () => ({ sandbox: 'Sandbox', tool: t('ui.kind_tool'), http: t('ui.kind_api'), model: t('ui.kind_model') });
const pages = () => ({
    runtime:{title:t('ui.simple_runtime'),subtitle:t('ui.simple_runtime_help'),eyebrow:'',tab:'',scope:''},
    settings:{title:t('ui.simple_settings'),subtitle:'',eyebrow:'',tab:'',scope:''},
    tokens:{title:t('ui.tokens'),eyebrow:t('ui.workspace_security'),subtitle:t('ui.tokens_help'),tab:t('ui.tokens'),scope:t('ui.workspace_security')},
    overview:{title:t('ui.overview'),eyebrow:t('ui.nav_operations'),subtitle:t('ui.overview_help'),tab:t('ui.overview'),scope:t('ui.nav_operations')},
    sessions:{title:t('ui.sessions'),eyebrow:'',subtitle:t('ui.simple_sessions_help'),tab:t('ui.sessions'),scope:t('ui.nav_operations')},
    runs:{title:t('ui.journey_tasks'),eyebrow:t('ui.nav_operations'),subtitle:t('ui.execution_help'),tab:t('ui.runs'),scope:t('ui.nav_operations')},
    pending:{title:t('ui.pending'),eyebrow:t('ui.nav_operations'),subtitle:t('ui.execution_help'),tab:t('ui.pending'),scope:t('ui.nav_operations')},
    setup:{title:t('ui.journey_home'),eyebrow:t('ui.nav_infrastructure'),subtitle:t('ui.journey_intro'),tab:t('ui.setup_title'),scope:t('ui.nav_infrastructure')},
    sandboxes: { kind: 'sandbox', title: t("ui.dense_sandbox"), eyebrow: t("ui.platform_execution_environments"), subtitle: t("ui.connect_cloud_sandboxes_used_by_the_platform_manage_provider_credentials"), tab: t("ui.provider_connections"), scope: t("ui.platform_infrastructure"), create: t("ui.add_sandbox") },
    tools: { kind: 'tool', title: t('ui.simple_tool_connections'), eyebrow: t("ui.agent_tool_integrations"), subtitle: t("ui.configure_tools_agents_can_call_manage_account_authorization_operations_and"), tab: t("ui.tool_connections"), scope: t("ui.agent_integrations"), create: t("ui.add_tool") },
    http: { kind: 'http', title: t("ui.protected_apis"), eyebrow: t("ui.agent_api_access"), subtitle: t("ui.give_agents_scoped_api_access_while_original_service_credentials_stay"), tab: t("ui.api_connections"), scope: t("ui.agent_integrations"), create: t("ui.add_api") },
    models: { kind: 'model', title: t("ui.dense_llm"), eyebrow: t("ui.agent_model_access"), subtitle: t("ui.connect_your_own_model_services_and_make_inference_endpoints_available"), tab: t("ui.model_connections"), scope: t("ui.agent_integrations"), create: t("ui.add_model_endpoint") },
    secrets: { title: t("ui.secrets"), eyebrow: t("ui.workspace_credentials"), subtitle: t("ui.store_rotate_and_disable_secrets_for_secure_references_from_platform"), tab: t("ui.saved_secrets"), scope: t("ui.workspace_security"), create: t("ui.new_secret") },
    agents:{title:t('ui.agents'),eyebrow:t('ui.nav_agent'),subtitle:t('ui.agents_help'),tab:t('ui.agents'),scope:t('ui.nav_agent')},
    harnesses:{create:t('ui.oci_register'),title:t('ui.harnesses'),eyebrow:t('ui.simple_runtime'),subtitle:t('ui.harnesses_help'),tab:t('ui.harnesses'),scope:t('ui.simple_runtime')},
    network: {title:t('ui.network_settings'),eyebrow:t('ui.nav_infrastructure'),subtitle:t('ui.network_help'),tab:t('ui.network_settings'),scope:t('ui.nav_infrastructure')},
    operations: {title:t('ui.resource_operations'),eyebrow:t('ui.nav_operations'),subtitle:t('ui.operations_help'),tab:t('ui.resource_operations'),scope:t('ui.nav_operations')},
    quickstart: { title: t('ui.api_playground'), eyebrow: t('ui.nav_agent'), subtitle: t('ui.simple_api_help'), tab: t('ui.qs_title'), scope: t('ui.agent_integrations') },
    fleet: { title: t("ui.sandbox_fleet"), eyebrow: t("ui.platform_operations"), subtitle: t("ui.inspect_cloud_environments_agent_status_previews_and_run_artifacts"), tab: t("ui.execution_session"), scope: t("ui.platform_operations_250") },
});
function setPageBack(parent){const back=$('page-back');back.hidden=!parent;if(parent){back.href=parent[0];back.setAttribute('aria-label',t(parent[1]));}else{back.removeAttribute('href');back.removeAttribute('aria-label');}}
const listFilters=new Map();
let filterRoute;
function navigate(next) {
    if(filterRoute)listFilters.set(filterRoute,{search:$('search').value,status:$('status-filter').value});
    filterRoute=next;
    const [route,query='']=next.split('?'); next=route==='setup'?'sessions':route==='runtime'?'sandboxes':route;
    view = pages()[next] ? next : 'sessions';
    $('workspace').dataset.view=view;$('content').classList.remove('session-detail','run-transcript');
    if(view==='quickstart'&&new URLSearchParams(query).has('agent'))seedSavedAgent(new URLSearchParams(query).get('agent'));
    if(view==='quickstart'&&new URLSearchParams(query).has('session'))seedSession(new URLSearchParams(query).get('session'));
    selected = view==='fleet'?new URLSearchParams(query).get('session'):null;
    selectedRun = view==='fleet'?new URLSearchParams(query).get('run'):null;
    $('notice').hidden = true;
    document.querySelectorAll('[data-view]').forEach(node => {
        node.classList.toggle('active', node.dataset.view === view);
        if (node.dataset.view === view)
            node.setAttribute('aria-current', 'page');
        else
            node.removeAttribute('aria-current');
    });
    const page = pages()[view];
    $('title').textContent = page.title;
    const params=new URLSearchParams(query);
    const parent=pageParent(view,params);
    setPageBack(parent);
    $('breadcrumb-current').textContent = ['sandboxes','models','harnesses','secrets','http'].includes(view)?t('ui.simple_runtime'):'';
    document.title = `Hexagon · ${page.title}`;
    $('eyebrow').textContent = page.eyebrow;
    $('subtitle').textContent = page.subtitle;$('subtitle').hidden=view==='sessions'&&new URLSearchParams(query).has('id');
    document.querySelector('[data-view=runtime]')?.classList.toggle('active',['sandboxes','models','harnesses','secrets','http'].includes(view));
    $('journey-path').hidden=true;$('journey-path').replaceChildren();document.querySelector('.section-tabs').hidden=true;
    if(['sandboxes','models','harnesses','secrets','http'].includes(view)){$('eyebrow').textContent=t('ui.simple_runtime');}
    $('navigation-toggle').setAttribute('aria-expanded','false');$('main-navigation').classList.remove('mobile-open');
    $('section-label').textContent = page.tab;
    $('scope-label').textContent = page.scope;
    $('create').hidden = (view==='sessions'&&new URLSearchParams(query).has('id'))||['fleet', 'quickstart','network','operations','agents','overview','runs','pending','setup','tokens','runtime','settings'].includes(view);
    document.querySelector('.workspace-toolbar').hidden = ['quickstart','network','operations','agents','harnesses','overview','sessions','runs','pending','setup','tokens','runtime','settings'].includes(view);
    if(['tools','secrets'].includes(view)&&new URLSearchParams(query).has('id')){document.querySelector('.workspace-toolbar').hidden=true;$('create').hidden=true;}
    $('create').textContent = view==='sessions'?t('ui.simple_api'):'+ ' + page.create;
    const filters=listFilters.get(next);
    $('search').value = filters?.search??'';
    $('status-filter').setOptions([{ value: 'all', label: t("ui.all_statuses") }, { value: 'ready', label: view === 'fleet' ? t("ui.healthy") : t("ui.enabled") }, { value: 'attention', label: view === 'secrets' ? t("ui.disabled_191") : t("ui.needs_attention") }]);
    $('status-filter').value = filters?.status??'all';
    $('search').placeholder = view === 'fleet' ? t("ui.search_sessions_harnesses_or_sandboxes") : view === 'secrets' ? t("ui.search_secrets") : t("ui.search_names_or_providers");
    if (token) {
        delete $('content').dataset.live; const pending=el('div', t("ui.loading"), 'loading-state'); pending.setAttribute('role','status'); pending.setAttribute('aria-live','polite'); $('content').replaceChildren(pending);
        refresh();
    }
}
function matchesSearch(text) { return String(text).toLowerCase().includes($('search').value.trim().toLowerCase()); }
function redraw() {
    if (!token)
        return;
    if (['network','operations','agents','harnesses','overview','sessions','runs','pending','setup','tokens','runtime','settings'].includes(view)) { refresh(); return; }
    if (view === 'quickstart')
        refresh();
    else if (view === 'fleet')
        renderFleet();
    else if (view === 'secrets')
        renderSecrets();
    else
        renderConnections();
}
$('status-filter').setOptions([{ value: 'all', label: t("ui.all_statuses") }, { value: 'ready', label: t("ui.ready_enabled") }, { value: 'attention', label: t("ui.needs_attention") }]);
$('status-filter').onchange = redraw;
$('search').oninput = redraw;
document.querySelector('.skip-link').onclick = event => {
    event.preventDefault();
    if (!$('workspace').hidden)
        $('workspace').focus();
    else
        $('api-token').focus();
};
window.addEventListener('hashchange', () => navigate(location.hash.slice(1)));
document.addEventListener('keydown', event => {
    if (event.key === '/' && !['quickstart','network','operations','agents','harnesses','overview','sessions','runs','pending','setup','tokens','runtime','settings'].includes(view) && !modalOpen() && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && !$('workspace').hidden) {
        event.preventDefault();
        $('search').focus();
    }
});
$('login-form').onsubmit = async (event) => {
    event.preventDefault();
    token = $('api-token').value;
    const submit = event.submitter;
    submit.disabled = true;submit.setAttribute('aria-busy','true');
    try {
        validateForm($('login-form'));
        await api('GET', '/health');
        $('api-token').value = '';
        $('login').hidden = true;
        $('workspace').hidden = false;
        $('logout').hidden = false;
        $('connection-state').textContent = t("ui.control_plane_connected");
        document.body.classList.add('connected');
        $('notice').hidden = true;
        await refresh();
    }
    catch (e) {
        token = '';
        noticeError(e);
    }
    finally {
        submit.disabled = false;submit.removeAttribute('aria-busy');
    }
};
$('logout').onclick = () => { token = ''; previewGrants.clear(); connections = []; fleet = []; secretRows = []; selected = null; $('content').replaceChildren(); $('workspace').hidden = true; $('login').hidden = false; $('logout').hidden = true; $('notice').hidden = true; $('connection-state').textContent = t("ui.not_connected"); document.body.classList.remove('connected'); };
$('create').onclick = async () => {
    try {
        if(view==='harnesses'){await openHarnessEditor();return;}
        if(view==='sessions'){location.hash=`quickstart?new=${crypto.randomUUID()}`;return;}
        if (view === 'secrets')
            openSecretEditor();
        else if(view==='sandboxes')openConnectionCatalog(providers().sandbox.map(([id,name])=>({id,name,description:t('ui.catalog_sandbox_card')})),id=>openEditor(null,id),noticeError,'sandbox');
        else if(view==='models')openConnectionCatalog(providers().model.map(([id,name])=>({id,name,icon:id.startsWith('openai')?'openai':'claude',description:t(id==='openai-responses'?'ui.responses_help':id==='openai-compatible'?'ui.catalog_openai_help':'ui.catalog_anthropic_help')})),id=>openEditor(null,id),noticeError,'model');
        else if(view==='tools'){const catalog=await api('GET','/applications');applicationCatalog=catalog.applications;oauthClients=catalog.oauth_clients;openToolCatalog(applicationCatalog,id=>openEditor(null,id),noticeError);}
        else
            await openEditor();
    }
    catch (error) {
        noticeError(error);
    }
};
$('refresh').onclick = refresh;
navigate(location.hash.slice(1));
setInterval(() => {
    if (token && ((view==='sessions'&&(!new URLSearchParams(location.hash.split('?')[1]??'').has('id')||$('content').dataset.live==='true'))||view === 'fleet'||(view==='runs'&&(!new URLSearchParams(location.hash.split('?')[1]??'').has('id')||$('content').dataset.live==='true'))) && !document.hidden && !window.getSelection()?.toString() && !modalOpen() && !document.querySelector('hx-select:focus-within, input:focus, textarea:focus, .action-menu:focus-within, #content details[open]:not(.execution-trace)'))
        refresh();
}, 5000);
function openSecretEditor(secret = null) { $('secret-error').hidden = true; formErrors.delete('secret-error'); editingSecret = secret; $('secret-name').value = secret?.name || ''; $('secret-value').value = ''; $('secret-value').required = !secret; $('secret-title').textContent = secret ? t("ui.update_rotate_secret") : t("ui.new_secret"); openModal('secret-editor'); }
function renderSecrets() {
    const secretId=new URLSearchParams(location.hash.split('?')[1]??'').get('id');if(secretId){renderSecretReferences($('content'),secretId,api).catch(()=>notice(()=>t('ui.access_failed'),true));return;}
    const root = $('content');
    root.replaceChildren();
    root.append(el('p', t("ui.only_names_and_status_are_shown_secret_values_are_never"), 'hint'));
    const linked=el('details',undefined,'configuration-disclosure');linked.append(el('summary',t('ui.connection_managed_credentials')));
    for(const c of connections.filter(c=>c.has_credential&&!c.secret_id)){const line=el('p');const a=el('a',c.name);a.href=c.kind==='sandbox'?'#sandboxes':c.kind==='model'?'#models':c.kind==='http'?'#http':'#tools';line.append(a,el('span',' · '+t('ui.connection_credentials_auto'),'hint'));linked.append(line);}root.append(linked);

    const { wrap, body } = table([t("ui.name"), t("ui.version_status"), t("ui.actions")]);
    for (const secret of secretRows.filter(secret => matchesSearch(secret.name) && ($('status-filter').value === 'all' || ($('status-filter').value === 'ready' ? secret.enabled : !secret.enabled)))) {
        const actions = el('div', undefined, 'row-actions');
        actions.append(button(t("ui.update_rotate"), () => openSecretEditor(secret)), button(secret.enabled ? t("ui.disable") : t("ui.enable"), async () => { await api('PATCH', `/secrets/${secret.id}`, { enabled: !secret.enabled }); notice(() => t("ui.secret_status_updated_verify_and_enable_its_connections_again")); await refresh(); }), button(t("ui.view_references"), () => {location.hash=`#secrets?id=${secret.id}`;}), button(t("ui.delete"), async () => {
            if (!await confirmAction(() => t("ui.delete_secret_name_referenced_secrets_cannot_be_deleted", { name: secret.name })))
                return;
            await api('DELETE', `/secrets/${secret.id}`);
            await refresh();
        }, 'danger'));
        const row = el('tr');
        row.append(cell(el('strong', secret.name)), cell(el('span', `v${secret.version} · ${secret.enabled ? t("ui.enable") : t("ui.disable")}`)), cell(compactActions(actions, secret.name, 1)));
        body.append(row);
    }
    if (!body.children.length)
        root.append(empty(secretRows.length ? t("ui.no_matching_secrets") : t("ui.save_your_first_secret"), t("ui.create_a_reusable_credential_to_reference_securely_from_connections")));
    else
        root.append(wrap);
}
$('secret-dismiss').onclick = $('secret-cancel').onclick = () => { $('secret-value').value = ''; closeModal('secret-editor'); };
$('secret-editor').addEventListener('close', () => { $('secret-value').value = ''; });
$('secret-form').onsubmit = async (event) => {
    event.preventDefault();
    event.submitter.disabled = true;event.submitter.setAttribute('aria-busy','true');
    try {
        validateForm($('secret-form'));
        const body = { name: $('secret-name').value, ...($('secret-value').value ? { value: $('secret-value').value } : {}) };
        await api(editingSecret ? 'PATCH' : 'POST', editingSecret ? `/secrets/${editingSecret.id}` : '/secrets', body);
        $('secret-value').value = '';
        closeModal('secret-editor');
        notice(() => t("ui.secret_saved"));
        await refresh();
    }
    catch (error) {
        showFormError('secret-error', error);
        $('secret-error').hidden = false;
    }
    finally {
        event.submitter.disabled = false;event.submitter.removeAttribute('aria-busy');
    }
};
const preferencesToggle=$('preferences-toggle'),preferencesPanel=$('preferences-panel');
const closePreferences=()=>{preferencesPanel.hidden=true;preferencesToggle.setAttribute('aria-expanded','false');};
preferencesToggle.onclick=()=>{const open=preferencesPanel.hidden;preferencesPanel.hidden=!open;preferencesToggle.setAttribute('aria-expanded',String(open));};
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.rail-settings'))closePreferences();});
preferencesPanel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();closePreferences();preferencesToggle.focus();}});
preferencesPanel.querySelector('a').addEventListener('click',closePreferences);
const placeLocale=()=>{const host=$('workspace').hidden?$('login-locale'):$('rail-locale');if($('locale').parentElement!==host)host.append($('locale'));const themeHost=$('workspace').hidden?$('login-theme'):$('rail-theme');if($('theme').parentElement!==themeHost)themeHost.append($('theme'));};
new MutationObserver(placeLocale).observe($('workspace'),{attributes:true,attributeFilter:['hidden']});placeLocale();
const paintTheme=()=>{$('theme').setOptions([{value:'system',label:t('ui.theme_system')},{value:'light',label:t('ui.theme_light')},{value:'dark',label:t('ui.theme_dark')}]);$('theme').value=window.hexagonTheme.preference;};
paintTheme();$('theme').onchange=()=>window.hexagonTheme.set($('theme').value);document.addEventListener('themechange',paintTheme);document.addEventListener('localechange',paintTheme);
$('locale').setOptions(localeOptions);
$('locale').value = getLocale();
$('locale').onchange = () => setLocale($('locale').value);
document.addEventListener('localechange', () => {
    paintIngress();
    const navigationOpen=$('navigation-toggle').getAttribute('aria-expanded')==='true';
    const search = $('search').value, filter = $('status-filter').value, session = selected, run = selectedRun;
    const showNotice = !$('notice').hidden;
    navigate(location.hash.slice(1));
    if(navigationOpen){$('navigation-toggle').setAttribute('aria-expanded','true');$('main-navigation').classList.add('mobile-open');}
    selected = session;
    selectedRun = run;
    $('search').value = search;
    $('status-filter').value = filter;
    $('locale').value = getLocale();
    $('connection-state').textContent = token ? t(localWorkspace()?'ui.local_connected':'ui.control_plane_connected') : t('ui.not_connected');
    if (showNotice && noticeState)
        paintNotice();
    if (!$('editor').hidden) {
        const active = document.activeElement;
        const id = active?.id;
        const start = active?.selectionStart, end = active?.selectionEnd;
        const values = new Map([...$('connection-form').querySelectorAll('input,textarea,hx-select')].map(input => [input.id, {value: input.value, checked: input.checked}]));
        const kind = $('kind').value;
        providerFields(editing?.config || {});
        for (const [field, value] of values)
            if ($(field))
                { $(field).value = value.value; if (value.checked !== undefined) $(field).checked = value.checked; }
        if ($('app-authentication')) document.querySelectorAll('[data-app-oauth]').forEach(node => node.hidden = $('app-authentication').value !== 'oauth');
        $('provider').setOptions(providers()[kind].map(([value, label]) => ({ value, label })));
        filterProviders();
        $('name').placeholder = t('ui.connection_name_example', { kind: kindTitles()[kind] });
        $('secret-reference').setOptions([{ value: '', label: t('ui.enter_credentials_directly') }, ...editorSecrets.filter(secret => secret.enabled || secret.id === editing?.secret_id).map(secret => ({ value: secret.id, label: secret.name }))]);
        $('editor-title').textContent = t(editing ? 'ui.configure_kind' : 'ui.add_kind', { kind: kindTitles()[kind] });
        $('editor-scope').textContent = ['sandbox','model'].includes(kind) ? t('ui.simple_runtime') : t('ui.agent_integration');
        $('editor-description').textContent = kind === 'sandbox' ? t('ui.configure_the_connection_used_by_the_platform_to_manage_cloud') : t('ui.configure_the_connection_used_by_agents_to_call_external_services');
        credentialMode();layoutSandboxEditor();
        if (id && $(id)) {
            $(id).focus();
            if (start !== null && start !== undefined)
                $(id).setSelectionRange?.(start, end);
        }
    }
    if (!$('secret-editor').hidden)
        $('secret-title').textContent = editingSecret ? t('ui.update_rotate_secret') : t('ui.new_secret');
    for (const [id, error] of formErrors)
        if (!$(id).hidden)
            $(id).textContent = errorText(error);
});

// Bootstrap only through the same-origin, loopback-only endpoint. Hosted retains explicit login.
async function connectLocalWorkspace(){
    $('login').hidden=true;
    try {
        const response=await fetch('/local/connect',{method:'POST',headers:{'X-Hexagon-Local':'1'},credentials:'same-origin',redirect:'error'});
        if(!response.ok){$('login').hidden=false;return;}
        const grant=await response.json();
        if(grant.mode!=='local'||!grant.token){$('login').hidden=false;return;}
        token=grant.token;setLocalWorkspace(grant.data_directory);
        $('api-token').value='';$('workspace').hidden=false;$('logout').hidden=true;
        $('connection-state').textContent=t('ui.local_connected');document.body.classList.add('connected');
        await refresh();
    }catch(error){token='';$('login').hidden=false;noticeError(error);}
}
void connectLocalWorkspace();

// Refresh idle operational views after an atomic frontend release; never discard an edited form.
const consoleReleaseVersion=document.querySelector('meta[name="hexagon-console-release"]')?.content;
if(consoleReleaseVersion)setInterval(async()=>{
    if(document.hidden||modalOpen()||view==='quickstart'||document.querySelector('input:focus,textarea:focus,hx-select:focus-within,#content details[open]'))return;
    try{const response=await fetch('/console/version',{cache:'no-store'});if(response.ok&&(await response.json()).version!==consoleReleaseVersion)location.reload();}catch{}
},10000);

// Make overflow regions discoverable to keyboard and screen-reader users.
new MutationObserver(() => {
    document.querySelectorAll('.table-wrap, #content pre').forEach(region => {
        region.tabIndex = 0;
        region.setAttribute('role', 'region');
        region.setAttribute('aria-labelledby', 'title');
    });
}).observe($('content'), {childList:true, subtree:true});

// Returning from prerequisite configuration refreshes choices while preserving the Playground draft.
window.addEventListener('focus',async()=>{
 if(!token||view!=='quickstart'||modalOpen()||loading)return;
 try{const [configured,catalog]=await Promise.all([api('GET','/connections'),api('GET','/catalog')]);
 if(view==='quickstart'&&!modalOpen()&&(JSON.stringify(configured.connections)!==JSON.stringify(connections)||JSON.stringify(catalog)!==JSON.stringify(executionCatalog)))await refresh();
 }catch{/* Keep the current draft; explicit refresh remains available. */}
});

export type Tunnel = {origin:string;close:()=>Promise<void>};
/** Management startup never depends on third-party ingress availability. */
export class DevelopmentIngress {
  private tunnel?:Tunnel;
  private pending?:Promise<void>;
  private stopped=false;
  private state:'disabled'|'starting'|'ready'|'unavailable'='disabled';
  private attempts=0;
  private checkedAt?:string;
  constructor(private open:()=>Promise<Tunnel>,private publish:(origin:string)=>void) {}
  status(){return {state:this.state,attempts:this.attempts,checked_at:this.checkedAt,...(this.state==='unavailable'?{code:'credential_proxy_tunnel_unavailable'}:{})};}
  start(){return this.opening(false);}
  retry(){return this.opening(true);}
  private opening(replace:boolean):Promise<void>{
    if(this.stopped)return Promise.resolve();
    if(this.pending)return this.pending;
    if(this.tunnel&&!replace)return Promise.resolve();
    this.state='starting';this.attempts++;
    // Defer work until pending is assigned, including synchronous opener failures.
    this.pending=Promise.resolve().then(async()=>{
      try {
        if(replace&&this.tunnel){const previous=this.tunnel;this.tunnel=undefined;this.publish('');await previous.close();}
        if(this.stopped)return;
        const tunnel=await this.open();
        if(this.stopped){await tunnel.close();return;}
        this.tunnel=tunnel;this.publish(tunnel.origin);this.state='ready';
      } catch {if(!this.stopped)this.state='unavailable';}
      finally {this.checkedAt=new Date().toISOString();this.pending=undefined;}
    });return this.pending;
  }
  async stop():Promise<void>{
    if(this.pending){await this.pending;return this.stop();}
    const tunnel=this.tunnel;this.tunnel=undefined;this.state='disabled';this.publish('');
    this.pending=Promise.resolve().then(async()=>{await tunnel?.close();}).finally(()=>{this.checkedAt=new Date().toISOString();this.pending=undefined;});
    return this.pending;
  }
  async close(){this.stopped=true;await this.stop();}
}

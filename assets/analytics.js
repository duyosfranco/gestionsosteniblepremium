(function(global){
  'use strict';
  const analytics = {
    sink: null,
    log(eventName, payload){
      const entry = Object.assign({
        event: eventName,
        ts: Date.now(),
        route: (global.gsRouter && global.gsRouter.getActiveRoute && global.gsRouter.getActiveRoute())
          ? global.gsRouter.getActiveRoute().key
          : null,
        uid: (global.gsSession && global.gsSession.getCurrentUser && global.gsSession.getCurrentUser())
          ? global.gsSession.getCurrentUser().uid
          : null,
        demo: global.gsSession && typeof global.gsSession.isDemoMode === 'function'
          ? global.gsSession.isDemoMode()
          : false
      }, payload || {});
      if(this.sink && typeof this.sink === 'function'){
        try{ this.sink(entry); }
        catch(err){ console.warn('Analytics sink failed', err); }
      }else{
        console.debug('[analytics]', entry);
      }
    }
  };
  global.gsAnalytics = analytics;
})(window);

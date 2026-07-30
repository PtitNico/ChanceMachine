import { TestBed } from '@angular/core/testing';
import { provideServiceWorker } from '@angular/service-worker';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      // `App` eagerly injects `PwaUpdate`, which injects `SwUpdate` - without this, DI has no
      // provider for it at all (`provideServiceWorker` is only wired up in app.config.ts, which
      // this bare TestBed setup doesn't use). `enabled: false` keeps it a no-op here, same as
      // `isDevMode()` does for a real dev server.
      providers: [provideServiceWorker('ngsw-worker.js', { enabled: false })],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});

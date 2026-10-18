import { registerLocaleData } from '@angular/common';
import localeFrBe from '@angular/common/locales/fr-BE';
import {
  LOCALE_ID,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  type ApplicationConfig,
} from '@angular/core';
import { TitleStrategy, provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { DataStore } from './core/services/data-store.service';
import { AppTitleStrategy } from './core/services/title-strategy';

registerLocaleData(localeFrBe);

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    { provide: LOCALE_ID, useValue: 'fr-BE' },
    provideAppInitializer(() => inject(DataStore).init()),
  ],
};

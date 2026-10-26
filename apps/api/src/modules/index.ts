import { CashRegisterModule } from './cash-register/cash-register.module';
import { ContactsModule } from './contacts/contacts.module';
import { MasterModule } from './master/master.module';
import { ProductMetaModule } from './products/product-meta.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { SellReturnsModule } from './sell-returns/sell-returns.module';
import { SettingsModule } from './settings/settings.module';
import { UsersModule } from './users/users.module';

/** Every feature module of the system. Add a module here once; AppModule imports the whole list. */
export const FEATURE_MODULES = [
  MasterModule,
  SettingsModule,
  ContactsModule,
  UsersModule,
  ProductsModule,
  ProductMetaModule,
  CashRegisterModule,
  SalesModule,
  SellReturnsModule,
];

import { Module } from '@nestjs/common';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { CustomerGroupsController } from './customer-groups.controller';
import { CustomerGroupsService } from './customer-groups.service';

/** Suppliers, customers and customer groups. */
@Module({
  controllers: [ContactsController, CustomerGroupsController],
  providers: [ContactsService, CustomerGroupsService],
  exports: [ContactsService],
})
export class ContactsModule {}

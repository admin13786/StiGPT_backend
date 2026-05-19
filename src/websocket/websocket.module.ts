import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WebsocketGateway } from './websocket.gateway';
import { MessageModule } from '../message/message.module';
import { TicketModule } from '../ticket/ticket.module';

@Module({
  imports: [
    MessageModule,
    ConfigModule,
    forwardRef(() => TicketModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'SusHber0XrWDhXz_mv5-TgRAnmgQlcinGtVT8d-2250niMFCw_Z9fHH5G78qL879',
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRES_IN') || '8h',
        },
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [
    WebsocketGateway,
  ],
  exports: [
    WebsocketGateway,
  ],
})
export class WebsocketModule {}

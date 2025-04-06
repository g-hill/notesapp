import { type ClientSchema, a, defineData } from '@aws-amplify/backend';

// Define a FriendshipStatus enum
const FriendshipStatus = {
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  DECLINED: 'DECLINED',
} as const;

const schema = a.schema({
  Note: a
    .model({
      name: a.string(),
      description: a.string(),
      image: a.string().optional(),
      task: a.string(),
      shared: a.boolean().default(false),
      owner: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  Friendship: a
    .model({
      requesterEmail: a.string(),
      receiverEmail: a.string(),
      status: a.enum(FriendshipStatus).required(),
    })
    .authorization((allow) => [
      allow.private().to(['read']),
      allow.owner('requesterEmail'),
      allow.owner('receiverEmail'),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: 'userPool',
  },
});
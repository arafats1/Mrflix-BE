import type { Schema, Struct } from '@strapi/strapi';

export interface AdminApiToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_tokens';
  info: {
    description: '';
    displayName: 'Api Token';
    name: 'Api Token';
    pluralName: 'api-tokens';
    singularName: 'api-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    encryptedKey: Schema.Attribute.Text &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::api-token'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.Enumeration<['read-only', 'full-access', 'custom']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'read-only'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminApiTokenPermission extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_api_token_permissions';
  info: {
    description: '';
    displayName: 'API Token Permission';
    name: 'API Token Permission';
    pluralName: 'api-token-permissions';
    singularName: 'api-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::api-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::api-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminPermission extends Struct.CollectionTypeSchema {
  collectionName: 'admin_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'Permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    actionParameters: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    conditions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::permission'> &
      Schema.Attribute.Private;
    properties: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<'manyToOne', 'admin::role'>;
    subject: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminRole extends Struct.CollectionTypeSchema {
  collectionName: 'admin_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'Role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::role'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<'oneToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<'manyToMany', 'admin::user'>;
  };
}

export interface AdminSession extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_sessions';
  info: {
    description: 'Session Manager storage';
    displayName: 'Session';
    name: 'Session';
    pluralName: 'sessions';
    singularName: 'session';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
    i18n: {
      localized: false;
    };
  };
  attributes: {
    absoluteExpiresAt: Schema.Attribute.DateTime & Schema.Attribute.Private;
    childId: Schema.Attribute.String & Schema.Attribute.Private;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::session'> &
      Schema.Attribute.Private;
    origin: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique;
    status: Schema.Attribute.String & Schema.Attribute.Private;
    type: Schema.Attribute.String & Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferToken extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_tokens';
  info: {
    description: '';
    displayName: 'Transfer Token';
    name: 'Transfer Token';
    pluralName: 'transfer-tokens';
    singularName: 'transfer-token';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    accessKey: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }> &
      Schema.Attribute.DefaultTo<''>;
    expiresAt: Schema.Attribute.DateTime;
    lastUsedAt: Schema.Attribute.DateTime;
    lifespan: Schema.Attribute.BigInteger;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminTransferTokenPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_transfer_token_permissions';
  info: {
    description: '';
    displayName: 'Transfer Token Permission';
    name: 'Transfer Token Permission';
    pluralName: 'transfer-token-permissions';
    singularName: 'transfer-token-permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'admin::transfer-token-permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.Relation<'manyToOne', 'admin::transfer-token'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface AdminUser extends Struct.CollectionTypeSchema {
  collectionName: 'admin_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'User';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    blocked: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    firstname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    isActive: Schema.Attribute.Boolean &
      Schema.Attribute.Private &
      Schema.Attribute.DefaultTo<false>;
    lastname: Schema.Attribute.String &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'admin::user'> &
      Schema.Attribute.Private;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    preferedLanguage: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    registrationToken: Schema.Attribute.String & Schema.Attribute.Private;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    roles: Schema.Attribute.Relation<'manyToMany', 'admin::role'> &
      Schema.Attribute.Private;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String;
  };
}

export interface ApiAccountInvitationAccountInvitation
  extends Struct.CollectionTypeSchema {
  collectionName: 'account_invitations';
  info: {
    description: 'Invitations for shared MrKeyp spaces';
    displayName: 'Account Invitation';
    pluralName: 'account-invitations';
    singularName: 'account-invitation';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    acceptedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime;
    invitee: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    inviteeEmail: Schema.Attribute.Email;
    inviter: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::account-invitation.account-invitation'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['pending', 'accepted', 'revoked', 'rejected', 'expired']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    token: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiActiveStreamActiveStream
  extends Struct.CollectionTypeSchema {
  collectionName: 'active_streams';
  info: {
    description: 'Tracks which users are currently streaming content and watch history';
    displayName: 'Active Stream';
    pluralName: 'active-streams';
    singularName: 'active-stream';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accessType: Schema.Attribute.Enumeration<
      ['purchased', 'subscription', 'free_trial', 'free_movie_of_week']
    > &
      Schema.Attribute.DefaultTo<'purchased'>;
    childProfile: Schema.Attribute.Relation<
      'manyToOne',
      'api::child-profile.child-profile'
    >;
    contentType: Schema.Attribute.Enumeration<['movie', 'episode']> &
      Schema.Attribute.DefaultTo<'movie'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deviceId: Schema.Attribute.String;
    endedAt: Schema.Attribute.DateTime;
    episodeNumber: Schema.Attribute.Integer;
    episodeSeason: Schema.Attribute.Integer;
    lastHeartbeat: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::active-stream.active-stream'
    > &
      Schema.Attribute.Private;
    movie: Schema.Attribute.Relation<'manyToOne', 'api::movie.movie'>;
    platform: Schema.Attribute.Enumeration<['web', 'tv', 'mobile']> &
      Schema.Attribute.DefaultTo<'web'>;
    positionSeconds: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    progress: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    startedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['watching', 'completed', 'stopped', 'abandoned']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'watching'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    watchedSeconds: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
  };
}

export interface ApiBookBook extends Struct.CollectionTypeSchema {
  collectionName: 'books';
  info: {
    description: 'Books library \u2014 adult and children PDFs and audiobooks';
    displayName: 'Book';
    pluralName: 'books';
    singularName: 'book';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    audienceType: Schema.Attribute.Enumeration<['adult', 'children']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'adult'>;
    audioUrl: Schema.Attribute.String;
    author: Schema.Attribute.String;
    category: Schema.Attribute.String;
    childAgeGroup: Schema.Attribute.Enumeration<
      ['ages_0_4', 'ages_5_8', 'ages_9_12', 'ages_13_17']
    >;
    classLabel: Schema.Attribute.String;
    comments: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    coverTone: Schema.Attribute.String & Schema.Attribute.DefaultTo<'ember'>;
    coverUrl: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    durationMinutes: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    educationLevel: Schema.Attribute.Enumeration<
      [
        'early_years',
        'primary',
        'ordinary_level',
        'advanced_level',
        'tertiary',
        'general',
      ]
    > &
      Schema.Attribute.DefaultTo<'general'>;
    format: Schema.Attribute.Enumeration<['pdf', 'audio', 'mixed']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pdf'>;
    isFeatured: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isPublished: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    likedBy: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    likesCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::book.book'> &
      Schema.Attribute.Private;
    minAge: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 21;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    pageCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    pdfUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    subject: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiChatLogChatLog extends Struct.CollectionTypeSchema {
  collectionName: 'chat_logs';
  info: {
    description: 'AI chat conversation logs from users and visitors';
    displayName: 'Chat Log';
    pluralName: 'chat-logs';
    singularName: 'chat-log';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ipAddress: Schema.Attribute.String;
    isGuest: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<true>;
    lastMessage: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::chat-log.chat-log'
    > &
      Schema.Attribute.Private;
    messageCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    messages: Schema.Attribute.JSON & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    sessionId: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userAgent: Schema.Attribute.String;
    userEmail: Schema.Attribute.String;
    userId: Schema.Attribute.Integer;
    userName: Schema.Attribute.String;
  };
}

export interface ApiChildProfileChildProfile
  extends Struct.CollectionTypeSchema {
  collectionName: 'child_profiles';
  info: {
    description: 'Per-child sub-profile owned by a parent account';
    displayName: 'Child Profile';
    pluralName: 'child-profiles';
    singularName: 'child-profile';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    allowedMovieIds: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    avatarUrl: Schema.Attribute.String;
    blockedMovieIds: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    childPinHash: Schema.Attribute.String;
    childPinUpdatedAt: Schema.Attribute.DateTime;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dailyWatchMinutes: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 1440;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<60>;
    dateOfBirth: Schema.Attribute.Date & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::child-profile.child-profile'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    parent: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    publishedAt: Schema.Attribute.DateTime;
    religion: Schema.Attribute.Enumeration<
      [
        'Catholic',
        'Protestant',
        'Pentecostal',
        'Adventist',
        'Orthodox',
        'Muslim',
        'Hindu',
        'Bahai',
        'Traditional',
        'Other',
      ]
    >;
    savingsGoals: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    savingsLifetimeDepositedUGX: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    totalSavingsUGX: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    unallocatedSavingsUGX: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiContactMessageContactMessage
  extends Struct.CollectionTypeSchema {
  collectionName: 'contact_messages';
  info: {
    description: 'User inquiries and suggestions from the contact form';
    displayName: 'Contact Message';
    pluralName: 'contact-messages';
    singularName: 'contact-message';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    category: Schema.Attribute.Enumeration<
      [
        'general',
        'suggestion',
        'bug_report',
        'payment_issue',
        'content_request',
        'book_request',
        'other',
      ]
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'general'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    email: Schema.Attribute.Email & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::contact-message.contact-message'
    > &
      Schema.Attribute.Private;
    message: Schema.Attribute.Text & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    replies: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    status: Schema.Attribute.Enumeration<
      ['new', 'read', 'replied', 'archived']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'new'>;
    subject: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.Integer;
  };
}

export interface ApiEducationCourseEducationCourse
  extends Struct.CollectionTypeSchema {
  collectionName: 'education_courses';
  info: {
    description: 'Admin-managed class/course options for provider education uploads';
    displayName: 'Education Course';
    pluralName: 'education-courses';
    singularName: 'education-course';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    educationLevel: Schema.Attribute.Enumeration<
      [
        'Kindergarten',
        'Primary',
        'Secondary',
        'Technical college',
        'University',
        'Other',
      ]
    > &
      Schema.Attribute.Required;
    educationLevelOther: Schema.Attribute.String;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::education-course.education-course'
    > &
      Schema.Attribute.Private;
    materials: Schema.Attribute.Relation<
      'oneToMany',
      'api::provider-material.provider-material'
    >;
    publishedAt: Schema.Attribute.DateTime;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    subject: Schema.Attribute.Relation<
      'manyToOne',
      'api::education-subject.education-subject'
    >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEducationSubjectEducationSubject
  extends Struct.CollectionTypeSchema {
  collectionName: 'education_subjects';
  info: {
    description: 'Admin-managed subject catalog for provider education content';
    displayName: 'Education Subject';
    pluralName: 'education-subjects';
    singularName: 'education-subject';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    courses: Schema.Attribute.Relation<
      'oneToMany',
      'api::education-course.education-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    educationLevel: Schema.Attribute.Enumeration<
      [
        'Kindergarten',
        'Primary',
        'Secondary',
        'Technical college',
        'University',
        'Other',
      ]
    > &
      Schema.Attribute.Required;
    educationLevelOther: Schema.Attribute.String;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::education-subject.education-subject'
    > &
      Schema.Attribute.Private;
    materials: Schema.Attribute.Relation<
      'oneToMany',
      'api::provider-material.provider-material'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    sortOrder: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepApplicationEntrepApplication
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_applications';
  info: {
    displayName: 'Entrep Job Application';
    pluralName: 'entrep-applications';
    singularName: 'entrep-application';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    applicant: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    applicantName: Schema.Attribute.String;
    coverNote: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    job: Schema.Attribute.Relation<'manyToOne', 'api::entrep-job.entrep-job'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-application.entrep-application'
    > &
      Schema.Attribute.Private;
    portfolioUrls: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['submitted', 'reviewing', 'shortlisted', 'rejected', 'hired']
    > &
      Schema.Attribute.DefaultTo<'submitted'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepAssignmentEntrepAssignment
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_assignments';
  info: {
    displayName: 'Entrep Assignment';
    pluralName: 'entrep-assignments';
    singularName: 'entrep-assignment';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    acceptedSubmissionTypes: Schema.Attribute.JSON &
      Schema.Attribute.DefaultTo<['video', 'image', 'document']>;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    dueAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    instructions: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-assignment.entrep-assignment'
    > &
      Schema.Attribute.Private;
    maxScore: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<100>;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    trainer: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepCertificateEntrepCertificate
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_certificates';
  info: {
    displayName: 'Entrep Certificate';
    pluralName: 'entrep-certificates';
    singularName: 'entrep-certificate';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    certificateNumber: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    courseTitle: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    finalScore: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    issuedAt: Schema.Attribute.DateTime;
    learnerName: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-certificate.entrep-certificate'
    > &
      Schema.Attribute.Private;
    pdfUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiEntrepClusterEntrepCluster
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_clusters';
  info: {
    description: 'Umbrella organizations coordinating learners/CBOs';
    displayName: 'Entrep Cluster';
    pluralName: 'entrep-clusters';
    singularName: 'entrep-cluster';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    contactEmail: Schema.Attribute.String;
    contactPerson: Schema.Attribute.String;
    contactPhone: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    industryCategory: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-cluster.entrep-cluster'
    > &
      Schema.Attribute.Private;
    members: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-profile.entrep-profile'
    >;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    organizationName: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    region: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepCourseEntrepCourse
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_courses';
  info: {
    description: 'Training course (Movo Entrepreneur)';
    displayName: 'Entrep Course';
    pluralName: 'entrep-courses';
    singularName: 'entrep-course';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accent: Schema.Attribute.String;
    assignments: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-assignment.entrep-assignment'
    >;
    category: Schema.Attribute.String;
    coverGradient: Schema.Attribute.String;
    coverUrl: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    durationWeeks: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    enrollmentsCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    level: Schema.Attribute.Enumeration<
      ['Beginner', 'Intermediate', 'Advanced']
    > &
      Schema.Attribute.DefaultTo<'Beginner'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-course.entrep-course'
    > &
      Schema.Attribute.Private;
    modules: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-module.entrep-module'
    >;
    passMark: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<80>;
    previewVideoUrl: Schema.Attribute.String;
    priceUGX: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    providerName: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    rating: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    rejectionFeedback: Schema.Attribute.Text;
    reviewsCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    shortDescription: Schema.Attribute.Text;
    skills: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    slug: Schema.Attribute.UID<'title'>;
    status: Schema.Attribute.Enumeration<
      ['draft', 'pending_review', 'approved', 'rejected', 'archived']
    > &
      Schema.Attribute.DefaultTo<'draft'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    topRecommended: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    trainer: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepDiscussionGroupEntrepDiscussionGroup
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_discussion_groups';
  info: {
    description: 'Private course discussion groups for enrolled learners';
    displayName: 'Entrep Discussion Group';
    pluralName: 'entrep-discussion-groups';
    singularName: 'entrep-discussion-group';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    creator: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-discussion-group.entrep-discussion-group'
    > &
      Schema.Attribute.Private;
    members: Schema.Attribute.Relation<
      'manyToMany',
      'plugin::users-permissions.user'
    >;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<['active', 'archived']> &
      Schema.Attribute.DefaultTo<'active'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepEnrollmentEntrepEnrollment
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_enrollments';
  info: {
    displayName: 'Entrep Enrollment';
    pluralName: 'entrep-enrollments';
    singularName: 'entrep-enrollment';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    assignmentResults: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    certificateIssued: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    completedAt: Schema.Attribute.DateTime;
    completedLessons: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    enrolledAt: Schema.Attribute.DateTime;
    lessonProgress: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-enrollment.entrep-enrollment'
    > &
      Schema.Attribute.Private;
    moduleQuizResults: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    overallScore: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    progressPct: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<['active', 'completed', 'dropped']> &
      Schema.Attribute.DefaultTo<'active'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiEntrepEventEntrepEvent extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_events';
  info: {
    description: 'Calendar events (deadlines, live sessions, milestones)';
    displayName: 'Entrep Event';
    pluralName: 'entrep-events';
    singularName: 'entrep-event';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    alumniAudience: Schema.Attribute.Enumeration<
      ['learner', 'trainer', 'cluster']
    >;
    color: Schema.Attribute.String;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    endsAt: Schema.Attribute.DateTime;
    eventType: Schema.Attribute.Enumeration<
      [
        'live_session',
        'quiz_deadline',
        'assignment_deadline',
        'announcement',
        'other',
      ]
    > &
      Schema.Attribute.DefaultTo<'other'>;
    learner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    liveSession: Schema.Attribute.Relation<
      'oneToOne',
      'api::entrep-live-session.entrep-live-session'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-event.entrep-event'
    > &
      Schema.Attribute.Private;
    mentorProfile: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    mentorship: Schema.Attribute.Relation<
      'oneToOne',
      'api::entrep-mentorship.entrep-mentorship'
    >;
    publishedAt: Schema.Attribute.DateTime;
    startsAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    visibility: Schema.Attribute.Enumeration<
      ['public', 'course', 'cluster', 'private', 'alumni']
    > &
      Schema.Attribute.DefaultTo<'course'>;
  };
}

export interface ApiEntrepJobEntrepJob extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_jobs';
  info: {
    displayName: 'Entrep Job';
    pluralName: 'entrep-jobs';
    singularName: 'entrep-job';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    applicationLink: Schema.Attribute.String;
    applicationsCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    closingAt: Schema.Attribute.DateTime;
    company: Schema.Attribute.String;
    companyLogo: Schema.Attribute.String;
    contactEmail: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    experienceLevel: Schema.Attribute.String;
    industry: Schema.Attribute.String;
    jobFunction: Schema.Attribute.String;
    jobType: Schema.Attribute.Enumeration<
      ['Full-time', 'Part-time', 'Internship', 'Contract', 'Freelance']
    > &
      Schema.Attribute.DefaultTo<'Full-time'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-job.entrep-job'
    > &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    postedBy: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    postedByProfile: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    publishedAt: Schema.Attribute.DateTime;
    salary: Schema.Attribute.String;
    skills: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    status: Schema.Attribute.Enumeration<
      ['draft', 'open', 'closed', 'filled']
    > &
      Schema.Attribute.DefaultTo<'open'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepLessonEntrepLesson
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_lessons';
  info: {
    displayName: 'Entrep Lesson';
    pluralName: 'entrep-lessons';
    singularName: 'entrep-lesson';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    bodyText: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    durationMin: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    imageUrl: Schema.Attribute.String;
    lessonType: Schema.Attribute.Enumeration<
      ['video', 'pdf', 'image', 'text', 'live', 'practical', 'quiz']
    > &
      Schema.Attribute.DefaultTo<'video'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-lesson.entrep-lesson'
    > &
      Schema.Attribute.Private;
    module: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-module.entrep-module'
    >;
    order: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    pdfUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    videoUrl: Schema.Attribute.String;
  };
}

export interface ApiEntrepLiveSessionRequestEntrepLiveSessionRequest
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_live_session_requests';
  info: {
    displayName: 'Entrep Live Session Request';
    pluralName: 'entrep-live-session-requests';
    singularName: 'entrep-live-session-request';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    liveSession: Schema.Attribute.Relation<
      'oneToOne',
      'api::entrep-live-session.entrep-live-session'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-live-session-request.entrep-live-session-request'
    > &
      Schema.Attribute.Private;
    message: Schema.Attribute.Text;
    publishedAt: Schema.Attribute.DateTime;
    requester: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<['pending', 'accepted', 'rejected']> &
      Schema.Attribute.DefaultTo<'pending'>;
    topic: Schema.Attribute.String;
    trainer: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepLiveSessionEntrepLiveSession
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_live_sessions';
  info: {
    description: 'Scheduled live training sessions (Whereby-backed)';
    displayName: 'Entrep Live Session';
    pluralName: 'entrep-live-sessions';
    singularName: 'entrep-live-session';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    alumniAudience: Schema.Attribute.Enumeration<
      ['learner', 'trainer', 'cluster']
    >;
    attendees: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    audience: Schema.Attribute.Enumeration<
      ['public', 'course', 'cluster', 'alumni']
    > &
      Schema.Attribute.DefaultTo<'public'>;
    cluster: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-cluster.entrep-cluster'
    >;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    durationMinutes: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<60>;
    endsAt: Schema.Attribute.DateTime;
    hostRoomUrl: Schema.Attribute.Text & Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-live-session.entrep-live-session'
    > &
      Schema.Attribute.Private;
    provider: Schema.Attribute.Enumeration<['whereby', 'zoom', 'jitsi']> &
      Schema.Attribute.DefaultTo<'whereby'>;
    publishedAt: Schema.Attribute.DateTime;
    recordingUrl: Schema.Attribute.Text;
    startsAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<
      ['scheduled', 'live', 'ended', 'cancelled']
    > &
      Schema.Attribute.DefaultTo<'scheduled'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    topic: Schema.Attribute.String;
    trainer: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    transcriptUrl: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    viewerRoomUrl: Schema.Attribute.Text;
    wherebyMeetingId: Schema.Attribute.String & Schema.Attribute.Private;
  };
}

export interface ApiEntrepMentorshipEntrepMentorship
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_mentorships';
  info: {
    displayName: 'Entrep Mentorship Request';
    pluralName: 'entrep-mentorships';
    singularName: 'entrep-mentorship';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    intent: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-mentorship.entrep-mentorship'
    > &
      Schema.Attribute.Private;
    mentee: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    mentor: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    message: Schema.Attribute.Text;
    publishedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['pending', 'accepted', 'rejected', 'completed']
    > &
      Schema.Attribute.DefaultTo<'pending'>;
    topic: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepModuleEntrepModule
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_modules';
  info: {
    displayName: 'Entrep Module';
    pluralName: 'entrep-modules';
    singularName: 'entrep-module';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    lessons: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-lesson.entrep-lesson'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-module.entrep-module'
    > &
      Schema.Attribute.Private;
    order: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    quiz: Schema.Attribute.Relation<'oneToOne', 'api::entrep-quiz.entrep-quiz'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepNotificationEntrepNotification
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_notifications';
  info: {
    description: 'In-app notifications for entrepreneur learners, mentors, and trainers';
    displayName: 'Entrep Notification';
    pluralName: 'entrep-notifications';
    singularName: 'entrep-notification';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    actionUrl: Schema.Attribute.String;
    actor: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-notification.entrep-notification'
    > &
      Schema.Attribute.Private;
    message: Schema.Attribute.Text;
    metadata: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<{}>;
    publishedAt: Schema.Attribute.DateTime;
    readAt: Schema.Attribute.DateTime;
    recipient: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Required;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<
      [
        'assignment',
        'live_session',
        'submission',
        'grade',
        'mentorship',
        'system',
      ]
    > &
      Schema.Attribute.DefaultTo<'system'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepPostEntrepPost extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_posts';
  info: {
    displayName: 'Entrep Community Post';
    pluralName: 'entrep-posts';
    singularName: 'entrep-post';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    alumniAudience: Schema.Attribute.Enumeration<
      ['learner', 'trainer', 'cluster']
    >;
    audience: Schema.Attribute.Enumeration<['public', 'alumni']> &
      Schema.Attribute.DefaultTo<'public'>;
    author: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    authorName: Schema.Attribute.String;
    authorRole: Schema.Attribute.String;
    comments: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    commentsCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    content: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    discussionGroup: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-discussion-group.entrep-discussion-group'
    >;
    isAnonymous: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isExpert: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    likedBy: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    likesCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-post.entrep-post'
    > &
      Schema.Attribute.Private;
    mediaUrls: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    postType: Schema.Attribute.Enumeration<
      ['community', 'topic', 'noticeboard', 'suggestion']
    > &
      Schema.Attribute.DefaultTo<'community'>;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['published', 'pending', 'rejected', 'hidden']
    > &
      Schema.Attribute.DefaultTo<'published'>;
    tags: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    title: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepProductEntrepProduct
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_products';
  info: {
    displayName: 'Entrep Marketplace Product';
    pluralName: 'entrep-products';
    singularName: 'entrep-product';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    category: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    emoji: Schema.Attribute.String;
    imageUrls: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-product.entrep-product'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    priceUGX: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    rating: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    seller: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-profile.entrep-profile'
    >;
    sellerName: Schema.Attribute.String;
    status: Schema.Attribute.Enumeration<
      ['draft', 'pending', 'approved', 'rejected', 'sold_out']
    > &
      Schema.Attribute.DefaultTo<'approved'>;
    stock: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepProfileEntrepProfile
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_profiles';
  info: {
    description: 'Profile for Movo Entrepreneur users (learner / trainer / cluster / provider / m&e)';
    displayName: 'Entrep Profile';
    pluralName: 'entrep-profiles';
    singularName: 'entrep-profile';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    age: Schema.Attribute.Integer;
    alumniCompletionDate: Schema.Attribute.Date;
    alumniCourseTitle: Schema.Attribute.String;
    alumniCurrentBusiness: Schema.Attribute.String;
    alumniJoinedAt: Schema.Attribute.DateTime;
    alumniMemberType: Schema.Attribute.Enumeration<
      ['learner', 'trainer', 'cluster']
    > &
      Schema.Attribute.DefaultTo<'learner'>;
    approvalStatus: Schema.Attribute.Enumeration<
      ['pending', 'approved', 'rejected', 'clarification']
    > &
      Schema.Attribute.DefaultTo<'approved'>;
    bio: Schema.Attribute.Text;
    certifications: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    cluster: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-cluster.entrep-cluster'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dateOfBirth: Schema.Attribute.Date;
    educationLevel: Schema.Attribute.String;
    email: Schema.Attribute.String;
    experienceLevel: Schema.Attribute.String;
    expertise: Schema.Attribute.String;
    fullName: Schema.Attribute.String & Schema.Attribute.Required;
    gender: Schema.Attribute.String;
    goal: Schema.Attribute.String;
    interestedRoles: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    isAlumni: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isMentor: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-profile.entrep-profile'
    > &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    mentorRating: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    nationalId: Schema.Attribute.String;
    onboardingComplete: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    phone: Schema.Attribute.String;
    portfolioUrls: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    preferredEventColor: Schema.Attribute.String &
      Schema.Attribute.DefaultTo<'#2563eb'>;
    profilePhotoUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Enumeration<
      ['learner', 'trainer', 'cluster', 'provider', 'admin', 'me']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'learner'>;
    savedJobs: Schema.Attribute.Relation<
      'manyToMany',
      'api::entrep-job.entrep-job'
    >;
    sessionsHosted: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    skills: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    socialMediaHandles: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::users-permissions.user'
    >;
    verificationDocumentUrls: Schema.Attribute.JSON &
      Schema.Attribute.DefaultTo<[]>;
    yearsOfExperience: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
  };
}

export interface ApiEntrepQuizAttemptEntrepQuizAttempt
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_quiz_attempts';
  info: {
    displayName: 'Entrep Quiz Attempt';
    pluralName: 'entrep-quiz-attempts';
    singularName: 'entrep-quiz-attempt';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    answers: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    attemptNumber: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-quiz-attempt.entrep-quiz-attempt'
    > &
      Schema.Attribute.Private;
    module: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-module.entrep-module'
    >;
    passed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    percentage: Schema.Attribute.Decimal & Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    quiz: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-quiz.entrep-quiz'
    >;
    score: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    submittedAt: Schema.Attribute.DateTime;
    totalPoints: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiEntrepQuizEntrepQuiz extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_quizzes';
  info: {
    description: 'Quiz/assessment attached to a module. Pass mark default 80%.';
    displayName: 'Entrep Quiz';
    pluralName: 'entrep-quizzes';
    singularName: 'entrep-quiz';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    instructions: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-quiz.entrep-quiz'
    > &
      Schema.Attribute.Private;
    maxAttempts: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<3>;
    passMark: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<80>;
    publishedAt: Schema.Attribute.DateTime;
    questions: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    timeLimitMinutes: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiEntrepSubmissionEntrepSubmission
  extends Struct.CollectionTypeSchema {
  collectionName: 'entrep_submissions';
  info: {
    displayName: 'Entrep Practical Submission';
    pluralName: 'entrep-submissions';
    singularName: 'entrep-submission';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    assignment: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-assignment.entrep-assignment'
    >;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-course.entrep-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    feedback: Schema.Attribute.Text;
    fileName: Schema.Attribute.String;
    grade: Schema.Attribute.Integer;
    gradedAt: Schema.Attribute.DateTime;
    lesson: Schema.Attribute.Relation<
      'manyToOne',
      'api::entrep-lesson.entrep-lesson'
    >;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::entrep-submission.entrep-submission'
    > &
      Schema.Attribute.Private;
    mediaUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['submitted', 'reviewing', 'approved', 'needs_revision', 'rejected']
    > &
      Schema.Attribute.DefaultTo<'submitted'>;
    submissionType: Schema.Attribute.Enumeration<
      ['video', 'image', 'audio', 'text', 'document']
    > &
      Schema.Attribute.DefaultTo<'text'>;
    submittedAt: Schema.Attribute.DateTime;
    textResponse: Schema.Attribute.Text;
    trainerFileName: Schema.Attribute.String;
    trainerMediaUrl: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiExclusiveSubscriptionExclusiveSubscription
  extends Struct.CollectionTypeSchema {
  collectionName: 'exclusive_subscriptions';
  info: {
    description: 'Monthly exclusive XXX content subscriptions';
    displayName: 'Exclusive Subscription';
    pluralName: 'exclusive-subscriptions';
    singularName: 'exclusive-subscription';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount: Schema.Attribute.Integer & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dgatewayReference: Schema.Attribute.String;
    endDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::exclusive-subscription.exclusive-subscription'
    > &
      Schema.Attribute.Private;
    originalAmount: Schema.Attribute.Integer;
    paymentMethod: Schema.Attribute.Enumeration<
      ['mtn_momo', 'airtel_money', 'pesapal', 'dgateway', 'yo']
    > &
      Schema.Attribute.Required;
    paymentPhone: Schema.Attribute.String & Schema.Attribute.Required;
    pesapalTrackingId: Schema.Attribute.String;
    promoCode: Schema.Attribute.String;
    promoDiscountPercent: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    startDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<
      ['active', 'expired', 'cancelled', 'pending']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    subscriber: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    transactionId: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    yoReference: Schema.Attribute.String;
  };
}

export interface ApiFreeTrialWatchFreeTrialWatch
  extends Struct.CollectionTypeSchema {
  collectionName: 'free_trial_watches';
  info: {
    description: 'Tracks movies/episodes users have watched during their free trial';
    displayName: 'Free Trial Watch';
    pluralName: 'free-trial-watches';
    singularName: 'free-trial-watch';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    contentType: Schema.Attribute.Enumeration<['movie', 'episode']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'movie'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    episodeNumber: Schema.Attribute.Integer;
    episodeSeason: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::free-trial-watch.free-trial-watch'
    > &
      Schema.Attribute.Private;
    movie: Schema.Attribute.Relation<'manyToOne', 'api::movie.movie'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiMarketplacePromotionMarketplacePromotion
  extends Struct.CollectionTypeSchema {
  collectionName: 'marketplace_promotions';
  info: {
    description: 'Paid marketplace product and seller promotions';
    displayName: 'Marketplace Promotion';
    pluralName: 'marketplace-promotions';
    singularName: 'marketplace-promotion';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dgatewayReference: Schema.Attribute.String;
    durationDays: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 30;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<1>;
    endDate: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::marketplace-promotion.marketplace-promotion'
    > &
      Schema.Attribute.Private;
    paymentMethod: Schema.Attribute.Enumeration<
      ['mtn_momo', 'airtel_money', 'pesapal', 'dgateway', 'yo', 'admin_granted']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pesapal'>;
    paymentPhone: Schema.Attribute.String;
    pesapalTrackingId: Schema.Attribute.String;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'>;
    promotionType: Schema.Attribute.Enumeration<['product', 'seller']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'product'>;
    publishedAt: Schema.Attribute.DateTime;
    seller: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    startDate: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['pending', 'active', 'expired', 'cancelled']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    transactionId: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    yoReference: Schema.Attribute.String;
  };
}

export interface ApiMarketplaceThreadMarketplaceThread
  extends Struct.CollectionTypeSchema {
  collectionName: 'marketplace_threads';
  info: {
    description: 'Chat thread between a buyer and a seller, optionally tied to a product';
    displayName: 'Marketplace Thread';
    pluralName: 'marketplace-threads';
    singularName: 'marketplace-thread';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    buyer: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    buyerUnread: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    lastMessageAt: Schema.Attribute.DateTime;
    lastMessageText: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::marketplace-thread.marketplace-thread'
    > &
      Schema.Attribute.Private;
    messages: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'>;
    publishedAt: Schema.Attribute.DateTime;
    seller: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    sellerUnread: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiMovieRequestMovieRequest
  extends Struct.CollectionTypeSchema {
  collectionName: 'movie_requests';
  info: {
    description: 'User requests for movies/series';
    displayName: 'Movie Request';
    pluralName: 'movie-requests';
    singularName: 'movie-request';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    adminNote: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::movie-request.movie-request'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    requester: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    status: Schema.Attribute.Enumeration<
      ['pending', 'approved', 'available', 'rejected', 'fulfilled']
    > &
      Schema.Attribute.DefaultTo<'pending'>;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    type: Schema.Attribute.Enumeration<['movie', 'series']> &
      Schema.Attribute.DefaultTo<'movie'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    whatsappNumber: Schema.Attribute.String;
  };
}

export interface ApiMovieMovie extends Struct.CollectionTypeSchema {
  collectionName: 'movies';
  info: {
    description: 'Movies and TV series catalog';
    displayName: 'Movie';
    pluralName: 'movies';
    singularName: 'movie';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    adultsOnly: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    backdrop: Schema.Attribute.Media<'images'>;
    backdropUrl: Schema.Attribute.String;
    bulkFolder: Schema.Attribute.String;
    bunnyVideoId: Schema.Attribute.String;
    childContentCategory: Schema.Attribute.Enumeration<
      ['General', 'Education', 'Religion']
    > &
      Schema.Attribute.DefaultTo<'General'>;
    countryOfOrigin: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    embedUrl: Schema.Attribute.String;
    episodes: Schema.Attribute.JSON;
    genres: Schema.Attribute.JSON;
    isAdult: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isAvailable: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    isFeatured: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isLuganda: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isShortClip: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isTrending: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isXXX: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::movie.movie'> &
      Schema.Attribute.Private;
    lugandaBunnyVideoId: Schema.Attribute.String;
    lugandaEpisodes: Schema.Attribute.JSON;
    lugandaVideoUrl: Schema.Attribute.String;
    lugandaVideoUrl480: Schema.Attribute.String;
    lugandaVideoUrl720: Schema.Attribute.String;
    minAge: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 21;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    overview: Schema.Attribute.Text;
    poster: Schema.Attribute.Media<'images'>;
    posterUrl: Schema.Attribute.String;
    priceUGX: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<2000>;
    publishedAt: Schema.Attribute.DateTime;
    rating: Schema.Attribute.Decimal;
    releaseDate: Schema.Attribute.Date;
    religiousCategory: Schema.Attribute.Enumeration<
      [
        'Catholic',
        'Protestant',
        'Pentecostal',
        'Adventist',
        'Orthodox',
        'Muslim',
        'Hindu',
        'Bahai',
        'Traditional',
        'Other',
      ]
    >;
    seasons: Schema.Attribute.Integer;
    subtitleUrl: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    tmdbId: Schema.Attribute.Integer;
    trailerUrl: Schema.Attribute.String;
    translatedLanguage: Schema.Attribute.Enumeration<
      [
        'Luganda',
        'Runyankole',
        'Rutooro',
        'Runyoro',
        'Rukiga',
        'Lusoga',
        'Acholi',
        'Lango',
        'Ateso',
        'Lugbara',
        'Swahili',
      ]
    >;
    type: Schema.Attribute.Enumeration<['movie', 'series']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'movie'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    video: Schema.Attribute.Media<'videos'>;
    videoUrl: Schema.Attribute.String;
    videoUrl480: Schema.Attribute.String;
    videoUrl720: Schema.Attribute.String;
    vjName: Schema.Attribute.String;
    watchCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
  };
}

export interface ApiMusicMusic extends Struct.CollectionTypeSchema {
  collectionName: 'music_tracks';
  info: {
    description: 'Music videos and audio tracks for the dedicated Music section';
    displayName: 'Music';
    pluralName: 'musics';
    singularName: 'music';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    artist: Schema.Attribute.String;
    audioUrl: Schema.Attribute.String;
    childAgeGroup: Schema.Attribute.Enumeration<
      ['ages_0_4', 'ages_5_8', 'ages_9_12', 'ages_13_17']
    >;
    comments: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    durationSeconds: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    embedUrl: Schema.Attribute.String;
    featureImageUrl: Schema.Attribute.String;
    genres: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    isExclusive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    isFeatured: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isPublished: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::music.music'> &
      Schema.Attribute.Private;
    mediaType: Schema.Attribute.Enumeration<['video', 'audio']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'video'>;
    minAge: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 21;
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    posterUrl: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    religiousCategory: Schema.Attribute.Enumeration<
      [
        'Catholic',
        'Protestant',
        'Pentecostal',
        'Adventist',
        'Orthodox',
        'Muslim',
        'Hindu',
        'Bahai',
        'Traditional',
        'Other',
      ]
    >;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    videoUrl: Schema.Attribute.String;
    videoUrl480: Schema.Attribute.String;
    videoUrl720: Schema.Attribute.String;
    watchCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
  };
}

export interface ApiProductReviewProductReview
  extends Struct.CollectionTypeSchema {
  collectionName: 'product_reviews';
  info: {
    description: 'Customer reviews for marketplace products';
    displayName: 'Product Review';
    pluralName: 'product-reviews';
    singularName: 'product-review';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    comment: Schema.Attribute.Text & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::product-review.product-review'
    > &
      Schema.Attribute.Private;
    productId: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    rating: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 5;
          min: 1;
        },
        number
      > &
      Schema.Attribute.DefaultTo<5>;
    reviewerName: Schema.Attribute.String & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<['approved', 'pending']> &
      Schema.Attribute.DefaultTo<'approved'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiProductProduct extends Struct.CollectionTypeSchema {
  collectionName: 'products';
  info: {
    description: 'Physical products for sale';
    displayName: 'Product';
    pluralName: 'products';
    singularName: 'product';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    ageRange: Schema.Attribute.String;
    audience: Schema.Attribute.Enumeration<['children', 'adults']> &
      Schema.Attribute.DefaultTo<'children'>;
    category: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    deliveryAreas: Schema.Attribute.JSON;
    description: Schema.Attribute.Text & Schema.Attribute.Required;
    discountPercent: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          max: 95;
          min: 0;
        },
        number
      >;
    featuredImage: Schema.Attribute.String & Schema.Attribute.Required;
    images: Schema.Attribute.JSON & Schema.Attribute.Required;
    itemType: Schema.Attribute.Enumeration<['product', 'service']> &
      Schema.Attribute.DefaultTo<'product'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::product.product'
    > &
      Schema.Attribute.Private;
    marketplaceSource: Schema.Attribute.Enumeration<['core', 'entrepreneur']> &
      Schema.Attribute.DefaultTo<'core'>;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    paymentCode: Schema.Attribute.String;
    paymentPhone: Schema.Attribute.String;
    priceUGX: Schema.Attribute.Integer & Schema.Attribute.Required;
    productVideoComments: Schema.Attribute.JSON;
    productVideoLikes: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    productVideoThumbnailUrl: Schema.Attribute.String;
    productVideoUrl: Schema.Attribute.String;
    promotedUntil: Schema.Attribute.DateTime;
    promotionBadgeLabel: Schema.Attribute.String;
    promotionKind: Schema.Attribute.Enumeration<['product', 'seller']>;
    publishedAt: Schema.Attribute.DateTime;
    seller: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    serviceAvailabilityDates: Schema.Attribute.JSON;
    serviceBookedDates: Schema.Attribute.JSON;
    status: Schema.Attribute.Enumeration<
      ['active', 'out_of_stock', 'discontinued']
    > &
      Schema.Attribute.DefaultTo<'active'>;
    stockQuantity: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<1>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiPromoCodePromoCode extends Struct.CollectionTypeSchema {
  collectionName: 'promo_codes';
  info: {
    description: 'Admin-generated promo codes that grant a percentage discount on subscriptions';
    displayName: 'Promo Code';
    pluralName: 'promo-codes';
    singularName: 'promo-code';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    discountPercent: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMax<
        {
          max: 100;
          min: 1;
        },
        number
      >;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::promo-code.promo-code'
    > &
      Schema.Attribute.Private;
    maxUses: Schema.Attribute.Integer &
      Schema.Attribute.SetMinMax<
        {
          min: 0;
        },
        number
      > &
      Schema.Attribute.DefaultTo<0>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    usedCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    validFrom: Schema.Attribute.DateTime;
    validUntil: Schema.Attribute.DateTime;
  };
}

export interface ApiProviderMaterialProviderMaterial
  extends Struct.CollectionTypeSchema {
  collectionName: 'provider_materials';
  info: {
    description: 'Teacher and religious provider content uploaded for the education section';
    displayName: 'Provider Material';
    pluralName: 'provider-materials';
    singularName: 'provider-material';
  };
  options: {
    draftAndPublish: true;
  };
  attributes: {
    ageRange: Schema.Attribute.Enumeration<
      ['ages_0_4', 'ages_5_8', 'ages_9_12', 'ages_13_17', 'all_ages']
    > &
      Schema.Attribute.DefaultTo<'all_ages'>;
    attachment: Schema.Attribute.Media<'files' | 'videos' | 'audios'>;
    audioAttachment: Schema.Attribute.Media<'audios'>;
    audioKey: Schema.Attribute.String;
    audioUrl: Schema.Attribute.String;
    classLabels: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    contentCategory: Schema.Attribute.Enumeration<['education', 'religion']> &
      Schema.Attribute.Required;
    course: Schema.Attribute.Relation<
      'manyToOne',
      'api::education-course.education-course'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    educationLevel: Schema.Attribute.Enumeration<
      [
        'Kindergarten',
        'Primary',
        'Secondary',
        'Technical college',
        'University',
        'Other',
      ]
    >;
    educationLevelOther: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::provider-material.provider-material'
    > &
      Schema.Attribute.Private;
    mediaType: Schema.Attribute.Enumeration<['pdf', 'video', 'audio']> &
      Schema.Attribute.Required;
    pdfAttachment: Schema.Attribute.Media<'files'>;
    pdfKey: Schema.Attribute.String;
    pdfUrl: Schema.Attribute.String;
    priceUGX: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<0>;
    provider: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    providerType: Schema.Attribute.Enumeration<['teacher', 'religious']> &
      Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    religion: Schema.Attribute.Enumeration<
      [
        'Catholic',
        'Protestant',
        'Pentecostal',
        'Adventist',
        'Orthodox',
        'Muslim',
        'Hindu',
        'Bahai',
        'Traditional',
        'Other',
      ]
    >;
    schoolName: Schema.Attribute.String;
    status: Schema.Attribute.Enumeration<['draft', 'published', 'rejected']> &
      Schema.Attribute.DefaultTo<'draft'>;
    subject: Schema.Attribute.Relation<
      'manyToOne',
      'api::education-subject.education-subject'
    >;
    thumbnail: Schema.Attribute.Media<'images'>;
    thumbnailKey: Schema.Attribute.String;
    thumbnailUrl: Schema.Attribute.String;
    title: Schema.Attribute.String & Schema.Attribute.Required;
    totalRevenueUGX: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    totalSales: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    videoAttachment: Schema.Attribute.Media<'videos'>;
    videoKey: Schema.Attribute.String;
    videoUrl: Schema.Attribute.String;
  };
}

export interface ApiPurchasePurchase extends Struct.CollectionTypeSchema {
  collectionName: 'purchases';
  info: {
    description: 'Movie purchase records';
    displayName: 'Purchase';
    pluralName: 'purchases';
    singularName: 'purchase';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount: Schema.Attribute.Integer & Schema.Attribute.Required;
    book: Schema.Attribute.Relation<'manyToOne', 'api::book.book'>;
    buyer: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    childProfile: Schema.Attribute.Relation<
      'manyToOne',
      'api::child-profile.child-profile'
    >;
    contactName: Schema.Attribute.String;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    customerTransactionId: Schema.Attribute.String;
    deliveryAddress: Schema.Attribute.Text;
    deliveryPhone: Schema.Attribute.String;
    deliveryStatus: Schema.Attribute.Enumeration<
      ['pending_delivery', 'delivered', 'not_delivered']
    > &
      Schema.Attribute.DefaultTo<'pending_delivery'>;
    dgatewayReference: Schema.Attribute.String;
    downloadCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    expiresAt: Schema.Attribute.DateTime;
    isPayOnDelivery: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::purchase.purchase'
    > &
      Schema.Attribute.Private;
    movie: Schema.Attribute.Relation<'manyToOne', 'api::movie.movie'>;
    paymentMethod: Schema.Attribute.Enumeration<
      [
        'mtn_momo',
        'airtel_money',
        'pesapal',
        'dgateway',
        'yo',
        'pay_on_delivery',
        'manual_supplier_payment',
        'free_trial',
        'referral_referred',
        'referral_referrer',
      ]
    > &
      Schema.Attribute.Required;
    paymentPhone: Schema.Attribute.String;
    pesapalTrackingId: Schema.Attribute.String;
    product: Schema.Attribute.Relation<'manyToOne', 'api::product.product'>;
    providerMaterial: Schema.Attribute.Relation<
      'manyToOne',
      'api::provider-material.provider-material'
    >;
    publishedAt: Schema.Attribute.DateTime;
    purchaseType: Schema.Attribute.Enumeration<
      ['read', 'download', 'book_subscription']
    >;
    savingsDepositApplied: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    seasonNumber: Schema.Attribute.Integer;
    serviceDate: Schema.Attribute.Date;
    status: Schema.Attribute.Enumeration<['pending', 'completed', 'failed']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    transactionId: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    yoReference: Schema.Attribute.String;
  };
}

export interface ApiReferralReferral extends Struct.CollectionTypeSchema {
  collectionName: 'referrals';
  info: {
    description: 'Tracks referral codes, activations, and rewards';
    displayName: 'Referral';
    pluralName: 'referrals';
    singularName: 'referral';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::referral.referral'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    referred: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    referredMoviesRemaining: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    referrer: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    referrerMoviesRemaining: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    rewardMovieCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<3>;
    status: Schema.Attribute.Enumeration<['pending', 'activated', 'rewarded']> &
      Schema.Attribute.DefaultTo<'pending'>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSearchHistorySearchHistory
  extends Struct.CollectionTypeSchema {
  collectionName: 'search_histories';
  info: {
    description: 'Tracks user search queries across all platforms';
    displayName: 'Search History';
    pluralName: 'search-histories';
    singularName: 'search-history';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::search-history.search-history'
    > &
      Schema.Attribute.Private;
    platform: Schema.Attribute.Enumeration<
      ['web', 'mobile', 'tv', 'mobile-luganda', 'tv-luganda']
    > &
      Schema.Attribute.DefaultTo<'web'>;
    publishedAt: Schema.Attribute.DateTime;
    query: Schema.Attribute.String & Schema.Attribute.Required;
    resultsCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.Integer;
    userName: Schema.Attribute.String;
  };
}

export interface ApiSharedLinkSharedLink extends Struct.CollectionTypeSchema {
  collectionName: 'shared_links';
  info: {
    description: 'Shareable links for folders and files';
    displayName: 'Shared Link';
    pluralName: 'shared-links';
    singularName: 'shared-link';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    accessCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime;
    file: Schema.Attribute.Relation<
      'manyToOne',
      'api::storage-file.storage-file'
    >;
    folder: Schema.Attribute.Relation<
      'manyToOne',
      'api::storage-folder.storage-folder'
    >;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::shared-link.shared-link'
    > &
      Schema.Attribute.Private;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    password: Schema.Attribute.String;
    permission: Schema.Attribute.Enumeration<['view', 'download']> &
      Schema.Attribute.DefaultTo<'view'>;
    publishedAt: Schema.Attribute.DateTime;
    token: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiSiteSettingSiteSetting extends Struct.SingleTypeSchema {
  collectionName: 'site_settings';
  info: {
    description: 'Global site configuration including pricing';
    displayName: 'Site Setting';
    pluralName: 'site-settings';
    singularName: 'site-setting';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    aboutPageContent: Schema.Attribute.JSON;
    apkDownloadCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    apkSize: Schema.Attribute.String;
    apkUpdatedAt: Schema.Attribute.DateTime;
    apkUrl: Schema.Attribute.String;
    apkVersion: Schema.Attribute.String;
    bookDownloadPrice: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<5000>;
    bookReadPrice: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<500>;
    bookSubscriptionPrice: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<10000>;
    contentMode: Schema.Attribute.Enumeration<['english', 'luganda', 'both']> &
      Schema.Attribute.DefaultTo<'both'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    exclusiveEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<true>;
    exclusivePrice: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<50000>;
    freeMovieOfWeekEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    freeMovieOfWeekExpiresAt: Schema.Attribute.DateTime;
    freeMovieOfWeekId: Schema.Attribute.String;
    freeTrialCount: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<2>;
    freeWatchMovieIds: Schema.Attribute.JSON;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::site-setting.site-setting'
    > &
      Schema.Attribute.Private;
    marketplacePromotionDailyPrice: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<5000>;
    marketplacePromotionMonthlyPrice: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<100000>;
    mobileApkDownloadCount: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<0>;
    mobileApkSize: Schema.Attribute.String;
    mobileApkUpdatedAt: Schema.Attribute.DateTime;
    mobileApkUrl: Schema.Attribute.String;
    mobileApkVersion: Schema.Attribute.String;
    moviePrice: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<2000>;
    movingText: Schema.Attribute.Text;
    paymentGateway: Schema.Attribute.Enumeration<
      ['pesapal', 'dgateway', 'yo']
    > &
      Schema.Attribute.DefaultTo<'pesapal'>;
    pesapalIpnId: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    referralEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<true>;
    referralRewardMovies: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<3>;
    revenueResetDate: Schema.Attribute.DateTime;
    seriesPrice: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<5000>;
    storageEnabled: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    storageFreeTierGB: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<1>;
    storagePricePerMonth: Schema.Attribute.Integer &
      Schema.Attribute.DefaultTo<5000>;
    subscriptionEnabled: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<true>;
    subscriptionPrice: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<20000>;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStorageFileStorageFile extends Struct.CollectionTypeSchema {
  collectionName: 'storage_files';
  info: {
    description: 'User uploaded files (photos, videos, documents)';
    displayName: 'Storage File';
    pluralName: 'storage-files';
    singularName: 'storage-file';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    duration: Schema.Attribute.Float;
    fileType: Schema.Attribute.Enumeration<
      ['image', 'video', 'document', 'audio', 'other']
    > &
      Schema.Attribute.Required;
    folder: Schema.Attribute.Relation<
      'manyToOne',
      'api::storage-folder.storage-folder'
    >;
    height: Schema.Attribute.Integer;
    isFavorite: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isTrash: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    key: Schema.Attribute.String & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::storage-file.storage-file'
    > &
      Schema.Attribute.Private;
    metadata: Schema.Attribute.JSON;
    mimeType: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    originalName: Schema.Attribute.String & Schema.Attribute.Required;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    publicUrl: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    size: Schema.Attribute.BigInteger & Schema.Attribute.Required;
    takenAt: Schema.Attribute.DateTime;
    thumbnailUrl: Schema.Attribute.String;
    trashedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    width: Schema.Attribute.Integer;
  };
}

export interface ApiStorageFolderStorageFolder
  extends Struct.CollectionTypeSchema {
  collectionName: 'storage_folders';
  info: {
    description: 'User folders for organizing files';
    displayName: 'Storage Folder';
    pluralName: 'storage-folders';
    singularName: 'storage-folder';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    children: Schema.Attribute.Relation<
      'oneToMany',
      'api::storage-folder.storage-folder'
    >;
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#6366f1'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.Text;
    files: Schema.Attribute.Relation<
      'oneToMany',
      'api::storage-file.storage-file'
    >;
    icon: Schema.Attribute.String & Schema.Attribute.DefaultTo<'folder'>;
    isTrash: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::storage-folder.storage-folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    owner: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    parent: Schema.Attribute.Relation<
      'manyToOne',
      'api::storage-folder.storage-folder'
    >;
    publishedAt: Schema.Attribute.DateTime;
    trashedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiStorageSubscriptionStorageSubscription
  extends Struct.CollectionTypeSchema {
  collectionName: 'storage_subscriptions';
  info: {
    description: 'User storage plan subscriptions';
    displayName: 'Storage Subscription';
    pluralName: 'storage-subscriptions';
    singularName: 'storage-subscription';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount: Schema.Attribute.Integer & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dgatewayReference: Schema.Attribute.String;
    durationMonths: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<1>;
    endDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    isUnlimited: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::storage-subscription.storage-subscription'
    > &
      Schema.Attribute.Private;
    paymentMethod: Schema.Attribute.Enumeration<
      ['mtn_momo', 'airtel_money', 'pesapal', 'dgateway', 'yo', 'admin_granted']
    > &
      Schema.Attribute.Required;
    paymentPhone: Schema.Attribute.String;
    pesapalTrackingId: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    startDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<
      ['active', 'expired', 'cancelled', 'pending']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    storageGB: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<1>;
    subscriber: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    transactionId: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    yoReference: Schema.Attribute.String;
  };
}

export interface ApiStoryStory extends Struct.CollectionTypeSchema {
  collectionName: 'stories';
  info: {
    description: 'Lit Stories - user-uploaded short videos';
    displayName: 'Story';
    pluralName: 'stories';
    singularName: 'story';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    authorName: Schema.Attribute.String & Schema.Attribute.Required;
    caption: Schema.Attribute.Text & Schema.Attribute.DefaultTo<''>;
    comments: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    isAnonymous: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isPublished: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    likes: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::story.story'> &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    userId: Schema.Attribute.String;
    videoUrl: Schema.Attribute.String & Schema.Attribute.Required;
    views: Schema.Attribute.JSON & Schema.Attribute.DefaultTo<[]>;
  };
}

export interface ApiSubscriptionSubscription
  extends Struct.CollectionTypeSchema {
  collectionName: 'subscriptions';
  info: {
    description: 'Monthly user subscriptions';
    displayName: 'Subscription';
    pluralName: 'subscriptions';
    singularName: 'subscription';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    amount: Schema.Attribute.Integer & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    dgatewayReference: Schema.Attribute.String;
    downloadCount: Schema.Attribute.Integer & Schema.Attribute.DefaultTo<0>;
    endDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::subscription.subscription'
    > &
      Schema.Attribute.Private;
    paymentMethod: Schema.Attribute.Enumeration<
      ['mtn_momo', 'airtel_money', 'pesapal', 'dgateway', 'yo']
    > &
      Schema.Attribute.Required;
    paymentPhone: Schema.Attribute.String & Schema.Attribute.Required;
    pesapalTrackingId: Schema.Attribute.String;
    publishedAt: Schema.Attribute.DateTime;
    startDate: Schema.Attribute.DateTime & Schema.Attribute.Required;
    status: Schema.Attribute.Enumeration<
      ['active', 'expired', 'cancelled', 'pending']
    > &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'pending'>;
    subscriber: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
    transactionId: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    yoReference: Schema.Attribute.String;
  };
}

export interface ApiTvCodeTvCode extends Struct.CollectionTypeSchema {
  collectionName: 'tv_codes';
  info: {
    description: 'Pairing codes for linking TV app to user accounts';
    displayName: 'TV Code';
    pluralName: 'tv-codes';
    singularName: 'tv-code';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    claimed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    code: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 6;
      }>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    expiresAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::tv-code.tv-code'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface ApiVjVj extends Struct.CollectionTypeSchema {
  collectionName: 'vjs';
  info: {
    description: 'Video Jockeys who translate movies to Luganda';
    displayName: 'VJ';
    pluralName: 'vjs';
    singularName: 'vj';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    isActive: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<'oneToMany', 'api::vj.vj'> &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface ApiWatchlistWatchlist extends Struct.CollectionTypeSchema {
  collectionName: 'watchlists';
  info: {
    description: 'User watchlist - movies to watch later';
    displayName: 'Watchlist';
    pluralName: 'watchlists';
    singularName: 'watchlist';
  };
  options: {
    draftAndPublish: false;
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'api::watchlist.watchlist'
    > &
      Schema.Attribute.Private;
    movie: Schema.Attribute.Relation<'manyToOne', 'api::movie.movie'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    user: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginContentReleasesRelease
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_releases';
  info: {
    displayName: 'Release';
    pluralName: 'releases';
    singularName: 'release';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    actions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    >;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    publishedAt: Schema.Attribute.DateTime;
    releasedAt: Schema.Attribute.DateTime;
    scheduledAt: Schema.Attribute.DateTime;
    status: Schema.Attribute.Enumeration<
      ['ready', 'blocked', 'failed', 'done', 'empty']
    > &
      Schema.Attribute.Required;
    timezone: Schema.Attribute.String;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginContentReleasesReleaseAction
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_release_actions';
  info: {
    displayName: 'Release Action';
    pluralName: 'release-actions';
    singularName: 'release-action';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentType: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    entryDocumentId: Schema.Attribute.String;
    isEntryValid: Schema.Attribute.Boolean;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::content-releases.release-action'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    release: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::content-releases.release'
    >;
    type: Schema.Attribute.Enumeration<['publish', 'unpublish']> &
      Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginI18NLocale extends Struct.CollectionTypeSchema {
  collectionName: 'i18n_locale';
  info: {
    collectionName: 'locales';
    description: '';
    displayName: 'Locale';
    pluralName: 'locales';
    singularName: 'locale';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    code: Schema.Attribute.String & Schema.Attribute.Unique;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::i18n.locale'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.SetMinMax<
        {
          max: 50;
          min: 1;
        },
        number
      >;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflow
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows';
  info: {
    description: '';
    displayName: 'Workflow';
    name: 'Workflow';
    pluralName: 'workflows';
    singularName: 'workflow';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    contentTypes: Schema.Attribute.JSON &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'[]'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    stageRequiredToPublish: Schema.Attribute.Relation<
      'oneToOne',
      'plugin::review-workflows.workflow-stage'
    >;
    stages: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginReviewWorkflowsWorkflowStage
  extends Struct.CollectionTypeSchema {
  collectionName: 'strapi_workflows_stages';
  info: {
    description: '';
    displayName: 'Stages';
    name: 'Workflow Stage';
    pluralName: 'workflow-stages';
    singularName: 'workflow-stage';
  };
  options: {
    draftAndPublish: false;
    version: '1.1.0';
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    color: Schema.Attribute.String & Schema.Attribute.DefaultTo<'#4945FF'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::review-workflows.workflow-stage'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String;
    permissions: Schema.Attribute.Relation<'manyToMany', 'admin::permission'>;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    workflow: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::review-workflows.workflow'
    >;
  };
}

export interface PluginUploadFile extends Struct.CollectionTypeSchema {
  collectionName: 'files';
  info: {
    description: '';
    displayName: 'File';
    pluralName: 'files';
    singularName: 'file';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    alternativeText: Schema.Attribute.Text;
    caption: Schema.Attribute.Text;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    ext: Schema.Attribute.String;
    focalPoint: Schema.Attribute.JSON;
    folder: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'> &
      Schema.Attribute.Private;
    folderPath: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    formats: Schema.Attribute.JSON;
    hash: Schema.Attribute.String & Schema.Attribute.Required;
    height: Schema.Attribute.Integer;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.file'
    > &
      Schema.Attribute.Private;
    mime: Schema.Attribute.String & Schema.Attribute.Required;
    name: Schema.Attribute.String & Schema.Attribute.Required;
    previewUrl: Schema.Attribute.Text;
    provider: Schema.Attribute.String & Schema.Attribute.Required;
    provider_metadata: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    related: Schema.Attribute.Relation<'morphToMany'>;
    size: Schema.Attribute.Decimal & Schema.Attribute.Required;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    url: Schema.Attribute.Text & Schema.Attribute.Required;
    width: Schema.Attribute.Integer;
  };
}

export interface PluginUploadFolder extends Struct.CollectionTypeSchema {
  collectionName: 'upload_folders';
  info: {
    displayName: 'Folder';
    pluralName: 'folders';
    singularName: 'folder';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    children: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.folder'>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    files: Schema.Attribute.Relation<'oneToMany', 'plugin::upload.file'>;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::upload.folder'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    parent: Schema.Attribute.Relation<'manyToOne', 'plugin::upload.folder'>;
    path: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 1;
      }>;
    pathId: Schema.Attribute.Integer &
      Schema.Attribute.Required &
      Schema.Attribute.Unique;
    publishedAt: Schema.Attribute.DateTime;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsPermission
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_permissions';
  info: {
    description: '';
    displayName: 'Permission';
    name: 'permission';
    pluralName: 'permissions';
    singularName: 'permission';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    action: Schema.Attribute.String & Schema.Attribute.Required;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    > &
      Schema.Attribute.Private;
    publishedAt: Schema.Attribute.DateTime;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
  };
}

export interface PluginUsersPermissionsRole
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_roles';
  info: {
    description: '';
    displayName: 'Role';
    name: 'role';
    pluralName: 'roles';
    singularName: 'role';
  };
  options: {
    draftAndPublish: false;
  };
  pluginOptions: {
    'content-manager': {
      visible: false;
    };
    'content-type-builder': {
      visible: false;
    };
  };
  attributes: {
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    description: Schema.Attribute.String;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.role'
    > &
      Schema.Attribute.Private;
    name: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
    permissions: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.permission'
    >;
    publishedAt: Schema.Attribute.DateTime;
    type: Schema.Attribute.String & Schema.Attribute.Unique;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    users: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    >;
  };
}

export interface PluginUsersPermissionsUser
  extends Struct.CollectionTypeSchema {
  collectionName: 'up_users';
  info: {
    description: '';
    displayName: 'User';
    name: 'user';
    pluralName: 'users';
    singularName: 'user';
  };
  options: {
    draftAndPublish: false;
    timestamps: true;
  };
  attributes: {
    accountType: Schema.Attribute.Enumeration<['parent', 'provider', 'both']> &
      Schema.Attribute.DefaultTo<'parent'>;
    avatarUrl: Schema.Attribute.String;
    blocked: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    bookLibraryAccessGrantedAt: Schema.Attribute.DateTime;
    childProfiles: Schema.Attribute.Relation<
      'oneToMany',
      'api::child-profile.child-profile'
    >;
    confirmationToken: Schema.Attribute.String & Schema.Attribute.Private;
    confirmed: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    createdAt: Schema.Attribute.DateTime;
    createdBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    educationLevel: Schema.Attribute.Enumeration<
      [
        'Kindergarten',
        'Primary',
        'Secondary',
        'Technical college',
        'University',
        'Other',
      ]
    >;
    educationLevelOther: Schema.Attribute.String;
    educationLevels: Schema.Attribute.JSON;
    email: Schema.Attribute.Email &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    fullName: Schema.Attribute.String;
    hasBookLibraryAccess: Schema.Attribute.Boolean &
      Schema.Attribute.DefaultTo<false>;
    isKeypUser: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    isParent: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<true>;
    keypActivatedAt: Schema.Attribute.DateTime;
    lastSeenAt: Schema.Attribute.DateTime;
    locale: Schema.Attribute.String & Schema.Attribute.Private;
    localizations: Schema.Attribute.Relation<
      'oneToMany',
      'plugin::users-permissions.user'
    > &
      Schema.Attribute.Private;
    location: Schema.Attribute.String;
    parentPinHash: Schema.Attribute.Password & Schema.Attribute.Private;
    parentPinUpdatedAt: Schema.Attribute.DateTime;
    password: Schema.Attribute.Password &
      Schema.Attribute.Private &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 6;
      }>;
    paymentCode: Schema.Attribute.String;
    paymentPhone: Schema.Attribute.String;
    phone: Schema.Attribute.String & Schema.Attribute.Unique;
    phoneOtpToken: Schema.Attribute.String & Schema.Attribute.Private;
    phoneVerified: Schema.Attribute.Boolean & Schema.Attribute.DefaultTo<false>;
    provider: Schema.Attribute.String;
    providerMaterials: Schema.Attribute.Relation<
      'oneToMany',
      'api::provider-material.provider-material'
    >;
    providerType: Schema.Attribute.Enumeration<
      [
        'teacher',
        'religious',
        'seller',
        'musician',
        'creative_artist',
        'comedian',
      ]
    >;
    providerTypes: Schema.Attribute.JSON;
    publishedAt: Schema.Attribute.DateTime;
    religion: Schema.Attribute.Enumeration<
      [
        'Catholic',
        'Protestant',
        'Pentecostal',
        'Adventist',
        'Orthodox',
        'Muslim',
        'Hindu',
        'Bahai',
        'Traditional',
        'Other',
      ]
    >;
    resetPasswordToken: Schema.Attribute.String & Schema.Attribute.Private;
    role: Schema.Attribute.Relation<
      'manyToOne',
      'plugin::users-permissions.role'
    >;
    schoolName: Schema.Attribute.String;
    subjectsTaught: Schema.Attribute.JSON;
    subscribedTeacherIds: Schema.Attribute.JSON;
    teacherBackground: Schema.Attribute.Text;
    teachingExperience: Schema.Attribute.Text;
    updatedAt: Schema.Attribute.DateTime;
    updatedBy: Schema.Attribute.Relation<'oneToOne', 'admin::user'> &
      Schema.Attribute.Private;
    username: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.Unique &
      Schema.Attribute.SetMinMaxLength<{
        minLength: 3;
      }>;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ContentTypeSchemas {
      'admin::api-token': AdminApiToken;
      'admin::api-token-permission': AdminApiTokenPermission;
      'admin::permission': AdminPermission;
      'admin::role': AdminRole;
      'admin::session': AdminSession;
      'admin::transfer-token': AdminTransferToken;
      'admin::transfer-token-permission': AdminTransferTokenPermission;
      'admin::user': AdminUser;
      'api::account-invitation.account-invitation': ApiAccountInvitationAccountInvitation;
      'api::active-stream.active-stream': ApiActiveStreamActiveStream;
      'api::book.book': ApiBookBook;
      'api::chat-log.chat-log': ApiChatLogChatLog;
      'api::child-profile.child-profile': ApiChildProfileChildProfile;
      'api::contact-message.contact-message': ApiContactMessageContactMessage;
      'api::education-course.education-course': ApiEducationCourseEducationCourse;
      'api::education-subject.education-subject': ApiEducationSubjectEducationSubject;
      'api::entrep-application.entrep-application': ApiEntrepApplicationEntrepApplication;
      'api::entrep-assignment.entrep-assignment': ApiEntrepAssignmentEntrepAssignment;
      'api::entrep-certificate.entrep-certificate': ApiEntrepCertificateEntrepCertificate;
      'api::entrep-cluster.entrep-cluster': ApiEntrepClusterEntrepCluster;
      'api::entrep-course.entrep-course': ApiEntrepCourseEntrepCourse;
      'api::entrep-discussion-group.entrep-discussion-group': ApiEntrepDiscussionGroupEntrepDiscussionGroup;
      'api::entrep-enrollment.entrep-enrollment': ApiEntrepEnrollmentEntrepEnrollment;
      'api::entrep-event.entrep-event': ApiEntrepEventEntrepEvent;
      'api::entrep-job.entrep-job': ApiEntrepJobEntrepJob;
      'api::entrep-lesson.entrep-lesson': ApiEntrepLessonEntrepLesson;
      'api::entrep-live-session-request.entrep-live-session-request': ApiEntrepLiveSessionRequestEntrepLiveSessionRequest;
      'api::entrep-live-session.entrep-live-session': ApiEntrepLiveSessionEntrepLiveSession;
      'api::entrep-mentorship.entrep-mentorship': ApiEntrepMentorshipEntrepMentorship;
      'api::entrep-module.entrep-module': ApiEntrepModuleEntrepModule;
      'api::entrep-notification.entrep-notification': ApiEntrepNotificationEntrepNotification;
      'api::entrep-post.entrep-post': ApiEntrepPostEntrepPost;
      'api::entrep-product.entrep-product': ApiEntrepProductEntrepProduct;
      'api::entrep-profile.entrep-profile': ApiEntrepProfileEntrepProfile;
      'api::entrep-quiz-attempt.entrep-quiz-attempt': ApiEntrepQuizAttemptEntrepQuizAttempt;
      'api::entrep-quiz.entrep-quiz': ApiEntrepQuizEntrepQuiz;
      'api::entrep-submission.entrep-submission': ApiEntrepSubmissionEntrepSubmission;
      'api::exclusive-subscription.exclusive-subscription': ApiExclusiveSubscriptionExclusiveSubscription;
      'api::free-trial-watch.free-trial-watch': ApiFreeTrialWatchFreeTrialWatch;
      'api::marketplace-promotion.marketplace-promotion': ApiMarketplacePromotionMarketplacePromotion;
      'api::marketplace-thread.marketplace-thread': ApiMarketplaceThreadMarketplaceThread;
      'api::movie-request.movie-request': ApiMovieRequestMovieRequest;
      'api::movie.movie': ApiMovieMovie;
      'api::music.music': ApiMusicMusic;
      'api::product-review.product-review': ApiProductReviewProductReview;
      'api::product.product': ApiProductProduct;
      'api::promo-code.promo-code': ApiPromoCodePromoCode;
      'api::provider-material.provider-material': ApiProviderMaterialProviderMaterial;
      'api::purchase.purchase': ApiPurchasePurchase;
      'api::referral.referral': ApiReferralReferral;
      'api::search-history.search-history': ApiSearchHistorySearchHistory;
      'api::shared-link.shared-link': ApiSharedLinkSharedLink;
      'api::site-setting.site-setting': ApiSiteSettingSiteSetting;
      'api::storage-file.storage-file': ApiStorageFileStorageFile;
      'api::storage-folder.storage-folder': ApiStorageFolderStorageFolder;
      'api::storage-subscription.storage-subscription': ApiStorageSubscriptionStorageSubscription;
      'api::story.story': ApiStoryStory;
      'api::subscription.subscription': ApiSubscriptionSubscription;
      'api::tv-code.tv-code': ApiTvCodeTvCode;
      'api::vj.vj': ApiVjVj;
      'api::watchlist.watchlist': ApiWatchlistWatchlist;
      'plugin::content-releases.release': PluginContentReleasesRelease;
      'plugin::content-releases.release-action': PluginContentReleasesReleaseAction;
      'plugin::i18n.locale': PluginI18NLocale;
      'plugin::review-workflows.workflow': PluginReviewWorkflowsWorkflow;
      'plugin::review-workflows.workflow-stage': PluginReviewWorkflowsWorkflowStage;
      'plugin::upload.file': PluginUploadFile;
      'plugin::upload.folder': PluginUploadFolder;
      'plugin::users-permissions.permission': PluginUsersPermissionsPermission;
      'plugin::users-permissions.role': PluginUsersPermissionsRole;
      'plugin::users-permissions.user': PluginUsersPermissionsUser;
    }
  }
}

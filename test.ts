import axios from 'axios'
import type { TrueLayerAccount, TrueLayerCard, TrueLayerMe, TrueLayerTransaction, TrueLayerTokenResponse } from './types'
import { NETWORK_TIMEOUT } from '../utils/network'

const res = axios.post<TrueLayerTokenResponse>(
    AUTH_URL,
    new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: "actualbudget-420cf4",
    client_secret: "tlcs_live_c9897cqrvzc2_2cjZHVKO7okBfk3TOUtz3AK2NlTDvw5RKQylupw5qPam",
    code: "8569E5D10CAAD561A4368D223241C4CC91545C00294E09FF263F3A0B2CD4DFF2",
    redirect_uri: "https://console.truelayer.com/redirect-page",
    }).toString(),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: NETWORK_TIMEOUT },
)
console.log({ access_token: res.data.access_token, refresh_token: res.data.refresh_token })

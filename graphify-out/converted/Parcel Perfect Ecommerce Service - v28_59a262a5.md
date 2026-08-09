<!-- converted from Parcel Perfect Ecommerce Service - v28.xlsx -->

## Sheet: getSalt
| getSalt Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_email | email | string | [50] |  | M  | The username - normally an email address - used for authentication |  |
| getSalt Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getSalt Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| salt | salt | string | [32] | MD5 |  | The salt to be combined with password to create an md5 hash |  |
## Sheet: getSecureToken
| getSecureToken Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_email | email | string | [50] |  | M  | The username - normally an email address - used for authentication |  |
| s_password | password | string | [32] | MD5 | M | The md5 hash of password+salt |  |
| getSecureToken Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getSecureToken Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| tokenid | tokenid | string | [40] | SHA1 |  | The token to be used with all subsequent requests |  |
## Sheet: getSingleWaybill
| getSingleWaybill Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_waybillno | waybillno | string | [24] |  | M | waybill number |  |
| getSingleWaybill Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getSingleWaybill Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| details | details | array | [..] |  |  | waybill details |  |
| contents | contents | array | [..] |  |  | contents array of waybill |  |
| tracks | tracks | array | [..] |  |  | tracking numbers for waybill |  |
| wayref | wayref | array | [..] |  |  | references for waybill |  |
| getSingleWaybill Results[details] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| waybill | waybill | string | [24] |  |  | waybill number |  |
| collect | collect | integer |  |  |  | collection number |  |
| pieces | pieces | integer |  |  |  | total number of pieces |  |
| service | service | string | [3] |  |  | transport service |  |
| waydate | waydate | string | [10] |  |  | waybill date |  |
| quotedate | quotedate | string | [10] |  |  | date waybill was quoted |  |
| accnum | accnum | string | [6] |  |  | customer account number |  |
| custname | custname | string | [35] |  |  | customer name |  |
| origpers | origpers | string | [35] |  |  | sender name or consignor |  |
| origplace | origplace | integer |  |  |  | internal number for town |  |
| origtown | origtown | string | [50] |  |  | originating town / place name |  |
| origpercontact | origpercontact | string | [30] |  |  | senders contact name |  |
| origperadd1 | origperadd1 | string | [30] |  |  | senders address line 1 |  |
| origperadd2 | origperadd2 | string | [30] |  |  | senders address line 2 |  |
| origperadd3 | origperadd3 | string | [30] |  |  | senders address line 3 |  |
| origperadd4 | origperadd4 | string | [30] |  |  | senders address line 4 |  |
| origperphone | origperphone | string | [30] |  |  | senders phone 1 |  |
| origperphone2 | origperphone2 | string | [20] |  |  | senders phone 2 |  |
| origpercell | origpercell | string | [20] |  |  | senders mobile number |  |
| origperpcode | origperpcode | string | [8] |  |  | senders postal code |  |
| destpers | destpers | string | [35] |  |  | receiver name or consignee |  |
| destplace | destplace | integer |  |  |  | internal number for town |  |
| desttown | desttown | string | [50] |  |  | destination town / place name |  |
| destpercontact | destpercontact | string | [30] |  |  | destination contact name |  |
| destperadd1 | destperadd1 | string | [30] |  |  | receiver address line 1 |  |
| destperadd2 | destperadd2 | string | [30] |  |  | receiver address line 2 |  |
| destperadd3 | destperadd3 | string | [30] |  |  | receiver address line 3 |  |
| destperadd4 | destperadd4 | string | [30] |  |  | receiver address line 4 |  |
| destperphone | destperphone | string | [20] |  |  | receiver phone 1 |  |
| destperphone2 | destperphone2 | string | [20] |  |  | receiver phone 2 |  |
| destpercell | destpercell | string | [20] |  |  | receivers mobile number |  |
| destperpcode | destperpcode | string | [8] |  |  | destination postal code |  |
| duedate | duedate | string | [10] |  |  | waybill due date |  |
| destlatitude | destlatitude | float |  |  |  | latitude co-ordinates |  |
| destlongitude | destlongitude | float |  |  |  | longitude co-ordinates |  |
| duedate | duedate | string | [10] |  |  | waybill due date |  |
| reference | reference | string | [15] |  |  | waybill reference number |  |
| specinstruction | specinstruction | string | [60] |  |  | special instruction |  |
| surchargeflag1 | surchargeflag1 | integer |  |  |  | surcharge flag 1 |  |
| surchargeflag2 | surchargeflag2 | integer |  |  |  | surcharge flag 2 |  |
| surchargeflag3 | surchargeflag3 | integer |  |  |  | surcharge flag 3 |  |
| surchargeflag4 | surchargeflag4 | integer |  |  |  | surcharge flag 4 |  |
| surchargeflag5 | surchargeflag5 | integer |  |  |  | surcharge flag 5 |  |
| surchargeflag6 | surchargeflag6 | integer |  |  |  | surcharge flag 6 |  |
| surchargeflag7 | surchargeflag7 | integer |  |  |  | surcharge flag 7 |  |
| surchargeflag8 | surchargeflag8 | integer |  |  |  | surcharge flag 8 |  |
| surchargeflag9 | surchargeflag9 | integer |  |  |  | surcharge flag 9 |  |
| invoice | invoice | integer |  |  |  | invoice number |  |
| quote | quote | string | [24] |  |  | quote number |  |
| insuranceflag | insuranceflag | integer |  |  |  | insurance flag |  |
| declaredvalue | declaredvalue | float |  |  |  | value of the freight for insurance |  |
| nondoxflag | nondoxflag | integer |  |  |  | not documents flag |  |
| customsvalue | customsvalue | float |  |  |  | value of freight for customs |  |
| currency | currency | float |  |  |  | transport cost currency |  |
| destperemail | destperemail | string | [50] |  |  | receiver email address |  |
| origperemail | origperemail | string | [50] |  |  | sender email address |  |
| actkg | actkg | float |  |  |  | total mass of contents in kg |  |
| volcm | volcm | integer |  |  |  | total volumetric cm |  |
| volrate | volrate | integer |  |  |  | volumetric divider |  |
| chargemass | chargemass | float |  |  |  | mass greater of vol mass and act kg |  |
| insurance | insurance | float |  |  |  | insurance charge |  |
| cartage | cartage | float |  |  |  | base transport charge |  |
| outly | outly | float |  |  |  | outlying charge |  |
| docs | docs | float |  |  |  | document charge |  |
| handling | handling | float |  |  |  | handling charge |  |
| cursurcharge | cursurcharge | float |  |  |  | currency surcharge |  |
| totsurcharge | totsurcharge | float |  |  |  | sum of all surcharges |  |
| subtotal | subtotal | float |  |  |  | subtotal charge |  |
| vat | vat | float |  |  |  | vat charge |  |
| total | total | float |  |  |  | total charge |  |
| customsduties | customsduties | float |  |  |  | customs duties charge |  |
| customsvat | customsvat | float |  |  |  | customs vat charge |  |
| manifest | manifest | integer |  |  |  | last manifest number |  |
| failtype | failtype | string | [30] |  |  | delivery failure reason |  |
| getSingleWaybill Results[contents] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| defitem | defitem | integer |  |  |  | >0 default contents item used |  |
| item | item | integer |  |  |  | numeric increment for number of contents lines |  |
| pieces | pieces | integer |  |  |  | total pieces on contents line |  |
| description | description | string | [30] |  |  | description of contents line |  |
| dim1 | dim1 | float |  |  |  | dimension 1 in cm |  |
| dim2 | dim2 | float |  |  |  | dimension 2 in cm |  |
| dim3 | dim3 | float |  |  |  | dimension 3 in cm |  |
| actmass | actmass | float |  |  |  | mass of contents line |  |
| getSingleWaybill Results[tracks] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| trackno | trackno | string | [28] |  |  | tracking number of parcel |  |
| parcelno | parcelno | integer |  |  |  | incremental count |  |
| item | item | integer |  |  |  | >0 links to item on contents |  |
| getSingleWaybill Results[wayref] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| reference | reference | string | [15] |  |  | reference number |  |
| pageno | pageno | integer |  |  |  | page number for multiple pages of same reference number |  |
## Sheet: requestQuote
| requestQuote Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| details | details | array | [..] |  | M | quote details |  |
| contents | contents | array | [..] |  | M | contents array for quote |  |
| wayrefs | wayrefs | array | [..] |  |  | tracking numbers for quote |  |
| tracks | tracks | array | [..] |  |  | references for quote |  |
| ttype | ttype | string | [1] |  | M | transaction type, default of 'I' |  |
| requestQuote Request[details] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| waybill          | waybill          | string | [24] |  |  | quote or waybill number |  |
| accnum           | accnum           | string | [6] |  |  | customer account number |  |
| costcentre       | costcentre       | integer |  |  |  | customer costcentre |  |
| service          | service          | string | [3] |  |  | transport service |  |
| waydate          | waydate          | string | [10] | dd.mm.yyyy |  | waybill date |  |
| origpers         | origpers         | string | [35] |  |  | sender name or consignor |  |
| origperadd1      | origperadd1      | string | [30] |  |  | senders address line 1 |  |
| origperadd2      | origperadd2      | string | [30] |  |  | senders address line 2 |  |
| origperadd3      | origperadd3      | string | [30] |  |  | senders address line 3 |  |
| origperadd4      | origperadd4      | string | [30] |  |  | senders address line 4 |  |
| origplace        | origplace        | integer |  |  |  | originating place number |  |
| origperpcode     | origperpcode     | string | [8] |  |  | senders postal code |  |
| origpercontact   | origpercontact   | string | [30] |  |  | senders contact name |  |
| origperphone     | origperphone     | string | [30] |  |  | senders phone 1 |  |
| origperphone2    | origperphone2    | string | [20] |  |  | senders phone 2 |  |
| origpercell      | origpercell      | string | [20] |  |  | senders mobile number |  |
| destpers         | destpers         | string | [35] |  |  | receiver name or consignee |  |
| destperadd1      | destperadd1      | string | [30] |  |  | receiver address line 1 |  |
| destperadd2      | destperadd2      | string | [30] |  |  | receiver address line 2 |  |
| destperadd3      | destperadd3      | string | [30] |  |  | receiver address line 3 |  |
| destperadd4      | destperadd4      | string | [30] |  |  | receiver address line 4 |  |
| destplace        | destplace        | integer |  |  |  | receiver place number |  |
| desttown         | desttown         | string | [50] |  |  | receiver town name |  |
| destperpcode     | destperpcode     | string | [8] |  |  | receiver postal code |  |
| destpercontact   | destpercontact   | string | [30] |  |  | receiver contact name |  |
| destperphone     | destperphone     | string | [20] |  |  | receiver phone 1 |  |
| destperphone2    | destperphone2    | string | [20] |  |  | receiver phone 2 |  |
| destpercell      | destpercell      | string | [20] |  |  | receivers mobile number |  |
| duedate          | duedate          | string | [10] | dd.mm.yyyy |  | waybill due date |  |
| specinstruction  | specinstruction  | string | [60] |  |  | special instruction |  |
| reference        | reference        | string | [15] |  |  | waybill reference number |  |
| insuranceflag    | insuranceflag    | integer |  |  |  | insurance flag |  |
| instype          | instype          | integer |  |  |  | insurance type |  |
| declaredvalue    | declaredvalue    | float |  |  |  | value of the freight for insurance |  |
| nondoxflag       | nondoxflag       | integer |  |  |  | not documents flag |  |
| currency         | currency         | float |  |  |  | transport cost currency |  |
| customsvalue     | customsvalue     | float |  |  |  | value of freight for customs |  |
| surchargeflag1   | surchargeflag1   | integer |  |  |  | surcharge flag 1 |  |
| surchargeflag2   | surchargeflag2   | integer |  |  |  | surcharge flag 2 |  |
| surchargeflag3   | surchargeflag3   | integer |  |  |  | surcharge flag 3 |  |
| surchargeflag4   | surchargeflag4   | integer |  |  |  | surcharge flag 4 |  |
| surchargeflag5   | surchargeflag5   | integer |  |  |  | surcharge flag 5 |  |
| surchargeflag6   | surchargeflag6   | integer |  |  |  | surcharge flag 6 |  |
| surchargeflag7   | surchargeflag7   | integer |  |  |  | surcharge flag 7 |  |
| surchargeflag8   | surchargeflag8   | integer |  |  |  | surcharge flag 8 |  |
| surchargeflag9   | surchargeflag9   | integer |  |  |  | surcharge flag 9 |  |
| requestQuote Request[contents] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| pieces | pieces | integer |  |  | M | number of pieces |  |
| description | description | string | [30] |  | M | freight description |  |
| dim1 | dim1 | integer |  |  |  | dimension 1 in centimetres |  |
| dim2 | dim2 | integer |  |  |  | dimension 2 in centimetres |  |
| dim3 | dim3 | integer |  |  |  | dimension 3 in centimetres |  |
| actmass | actmass | float |  |  | M | mass in kilograms |  |
| item | item | integer |  |  | M | start from 1, per array entry |  |
| defitem | defitem | integer |  |  |  | default content item unique code |  |
| requestQuote Request[wayref] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_reference | reference | string | [15] |  | M | reference number |  |
| i_pageno | pageno | integer |  |  | M | set to 1. Increment for multiple instances of a reference number |  |
| requestQuote Request[tracks] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_trackno | trackno | string | [28] |  | M | unique tracking number |  |
| i_parcelno | parcelno | integer |  |  | M | increment, start from 1 |  |
| i_item | item | integer |  |  |  | Required if linking tracking numbers to specific pieces in contents array |  |
| requestQuote Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| requestQuote Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| quoteno             | quoteno             | string | [24] |  |  | quote number generated |  |
| gentracking_retval  | gentracking_retval  | int |  |  |  | 1 = tracking numbers generated |  |
| recalcwb_retval     | recalcwb_retval     | int |  |  |  | 1 = waybill has been recalculated |  |
| rates      | rates      | array | [..] |  |  | array of rates by service |  |
| requestQuote Results[rates] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| service         | service         | string | [3] |  |  | 3 character service code |  |
| name            | name            | string | [33] |  |  | service name description |  |
| charge          | charge          | float |  |  |  | basic transport charge |  |
| insurance       | insurance       | float |  |  |  | insurance charge |  |
| customsvalue    | customsvalue    | float |  |  |  | customs value of freight |  |
| outly           | outly           | float |  |  |  | outlying charge |  |
| docs            | docs            | float |  |  |  | document charge |  |
| handling        | handling        | float |  |  |  | handling charge |  |
| cursurcharge    | cursurcharge    | float |  |  |  | currency surcharge |  |
| totsurcharge    | totsurcharge    | float |  |  |  | total of surcharges |  |
| subtotal        | subtotal        | float |  |  |  | subtotal |  |
| vat             | vat             | float |  |  |  | total charge of quote |  |
| total           | total           | float |  |  |  | vat |  |
| customsduties   | customsduties   | float |  |  |  | customs duties |  |
| customsvat      | customsvat      | float |  |  |  | customs vat |  |
| duedate         | duedate         | string |  | dd.mm.yyyy |  | due date of waybill |  |
| duetime         | duetime         | string |  | hh:mm:ss |  | due time of waybill |  |
## Sheet: updateService
| updateService Request |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| quoteno | quoteno | string | [24] |  | M | quote number to be updated |  |  |
| service | service | string | [3] |  | M | service code to set on updated quote |  |  |
| reference | reference | string | [18] |  |  | customer reference |  |  |
| updateService Response |  |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |  |
| updateService Response[results] |  |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| quoteno | quoteno | string |  |  |  | quote number generated |  |  |
| service | service | string |  |  |  | 3 character service code |  |  |
| actkg | actkg | float |  |  |  | total mass of shipment in kgs |  |  |
| chargemass | chargemass | float |  |  |  | total chargeable mass |  |  |
| insurance | insurance | float |  |  |  | insurance charge |  |  |
| outly | outly | float |  |  |  | outlying charge |  |  |
| docs | docs | float |  |  |  | documentation charge |  |  |
| handling | handling | float |  |  |  | handling surcharge |  |  |
| cursurcharge | cursurcharge | float |  |  |  | currency surcharge |  |  |
| totsurcharge | totsurcharge | float |  |  |  | total of surcharges |  |  |
| subtotal | subtotal | float |  |  |  | total of charges before vat |  |  |
| vat | vat | float |  |  |  | vat |  |  |
| total | total | float |  |  |  | total charge of quote |  |  |
| cartage | cartage | float |  |  |  | basic transport charge |  |  |
## Sheet: quoteToWaybill
| quoteToWaybill Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| quoteno | quoteno | string | [24] |  | M | quote number previously generated by requestQuote |  |
| waybillno | waybillno | string | [24] |  |  | waybill number |  |
| specins | specins | string | [60] |  |  | special instructions |  |
| printWaybill | printWaybill | integer |  |  |  | 1 = return base64 encoded waybill pdf |  |
| printLabels | printLabels | integer |  |  |  | 1 = return base64 encoded labels pdf |  |
| quoteToWaybill Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| quoteToWaybill Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| waybillno | waybillno | string |  |  |  | waybill number generated |  |
| gentracking_retval | gentracking_retval | integer |  |  |  | 1 = tracking numbers generated |  |
| recalcwb_retval | recalcwb_retval | integer |  |  |  | 1 = waybill has been recalculated |  |
| waybillBase64 | waybillBase64 | base64 |  |  |  | base64 encoded string for waybill pdf |  |
| labelsBase64 | labelsBase64 | base64 |  |  |  | base64 encoded string for labels pdf |  |
## Sheet: getPlacesByName
| getPlacesByName Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| name | name | string | [50] |  | M | name or partial name in place list to search for |  |
| getPlacesByName Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getPlacesByName Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| town | town | string |  |  |  | returns a list of places/towns |  |
| place | place | integer |  |  |  | town name |  |
| pcode | pcode | string |  |  |  | internal identifier for place/town |  |
## Sheet: getPlacesByPostcode
| getPlacesByPostcode Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| postcode | postcode | string | [10] |  | M | postcode to search for |  |
| getPlacesByPostcode Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getPlacesByPostcode Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| town | town | string |  |  |  | returns a list of places/towns |  |
| place | place | integer |  |  |  | town name |  |
| pcode | pcode | string |  |  |  | internal identifier for place/town |  |
## Sheet: getDefItems
| getDefItems Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_name | name | string | [30] | string | M | default content item name | Requires that the courier has configured default content items for the client |
| getDefItems Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | string |  |  |  | The error message if errorcode is a non-zero value |  |
| results | results | array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| getDefItems Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| defitem | defitem | integer |  |  |  | unique default item number |  |
| name | name | string | [30] |  |  | item name |  |
| dim1 | dim1 | integer |  |  |  | length |  |
| dim2 | dim2 | integer |  |  |  | width |  |
| dim3 | dim3 | integer |  |  |  | height |  |
| actkg | actkg | float |  |  |  | total mass of item |  |
| amount | amount | float |  |  |  | item amount |  |
| partno | partno | string | [20] |  |  | unique customer part number |  |
| itemvalue | itemvalue | float |  |  |  | item value |  |
| accnum | accnum | string | [6] |  |  | account number |  |
## Sheet: submitCollection
| submitCollection Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| details | details | array | [..] |  | M | collection address information |  |
| contents | contents | array | [..] |  | M | collection content information |  |
| s_ttype | ttype | string | [1] |  |  | transaction type |  |
| printWaybill | printWaybill | integer |  |  |  | 1 = return base64 encoded waybill pdf |  |
| printLabels | printLabels | integer |  |  |  | 1 = return base64 encoded labels pdf |  |
| submitCollection Request[details] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| collectno | collectno | string |  |  |  | collection number of existing collection |  |
| waybill | waybill | string |  |  |  | wabill number for the waybill linked to the collection |  |
| accnum | accnum | string | [6] |  |  | customer account number |  |
| costcentre | costcentre | string |  |  |  | customer costcentre |  |
| service | service | string | [3] |  | M | transport service |  |
| collectiondate | collectiondate | string | [10] | dd.mm.yyyy | M | date for the collection |  |
| origpers | origpers | string | [35] |  | M | sender name or consignor |  |
| origperadd1 | origperadd1 | string | [30] |  | M | senders address line 1 |  |
| origperadd2 | origperadd2 | string | [30] |  |  | senders address line 2 |  |
| origperadd3 | origperadd3 | string | [30] |  |  | senders address line 3 |  |
| origperadd4 | origperadd4 | integer | [30] |  |  | senders address line 4 |  |
| origplace | origplace | string |  |  |  | originating place number |  |
| origtown | origtown | string |  |  | M | originating town name |  |
| origperpcode | origperpcode | string | [30] |  | M | senders postal code |  |
| origpercontact | origpercontact | string | [30] |  | M | senders contact name |  |
| origperphone | origperphone | string | [30] |  | M | senders phone 1 |  |
| origperphone2 | origperphone2 | string | [20] |  |  | senders phone 2 |  |
| origpercell | origpercell | string | [20] |  |  | senders mobile number |  |
| destpers | destpers | string | [35] |  | M | receiver name or consignee |  |
| destperadd1 | destperadd1 | string | [30] |  | M | receiver address line 1 |  |
| destperadd2 | destperadd2 | integer | [30] |  |  | receiver address line 2 |  |
| destperadd3 | destperadd3 | integer | [30] |  |  | receiver address line 3 |  |
| destperadd4 | destperadd4 | float | [30] |  |  | receiver address line 4 |  |
| destplace | destplace | integer |  |  |  | receiver place number |  |
| desttown | desttown | string | [50] |  | M | receiver town name |  |
| destperpcode | destperpcode | float | [8] |  | M | receiver postal code |  |
| destpercontact | destpercontact | integer | [30] |  | M | receiver contact name |  |
| destperphone | destperphone | integer | [20] |  | M | receiver phone 1 |  |
| destperphone2 | destperphone2 | integer | [20] |  |  | receiver phone 2 |  |
| destpercell | destpercell | integer | [20] |  |  | receivers mobile number |  |
| duedate | duedate | integer | [10] | dd.mm.yyyy |  | waybill due date |  |
| specinstruction | specinstruction | integer | [60] |  |  | special instruction |  |
| reference | reference | integer | [15] |  |  | waybill reference number |  |
| insuranceflag | insuranceflag | integer |  |  |  | insurance flag |  |
| instype | instype | integer |  |  |  | insurance type |  |
| declaredvalue | declaredvalue | string |  |  |  | value of the freight for insurance |  |
| nondoxflag | nondoxflag | integer |  |  |  | not documents flag |  |
| currency | currency | float |  |  |  | transport cost currency |  |
| customsvalue | customsvalue | float |  |  |  | value of freight for customs |  |
| surchargeflag1 | surchargeflag1 | integer |  |  |  | surcharge flag 1 |  |
| surchargeflag2 | surchargeflag2 | integer |  |  |  | surcharge flag 2 |  |
| surchargeflag3 | surchargeflag3 | integer |  |  |  | surcharge flag 3 |  |
| surchargeflag4 | surchargeflag4 | integer |  |  |  | surcharge flag 4 |  |
| surchargeflag5 | surchargeflag5 | integer |  |  |  | surcharge flag 5 |  |
| surchargeflag6 | surchargeflag6 | integer |  |  |  | surcharge flag 6 |  |
| surchargeflag7 | surchargeflag7 | integer |  |  |  | surcharge flag 7 |  |
| surchargeflag8 | surchargeflag8 | integer |  |  |  | surcharge flag 8 |  |
| surchargeflag9 | surchargeflag9 | integer |  |  |  | surcharge flag 9 |  |
| starttime | starttime | string | [8] | hh:mm:ss |  | time the collection is ready |  |
| endtime | endtime | string | [8] | hh:mm:ss |  | time the collection is closed |  |
| notes | notes | string | [150] |  |  | notes for the collection quest |  |
| submitCollection Request[contents] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| pieces | pieces | integer |  |  | M | number of pieces |  |
| description | description | string | [30] |  | M | freight description |  |
| dim1 | dim1 | integer |  |  |  | dimension 1 in centimetres |  |
| dim2 | dim2 | integer |  |  |  | dimension 2 in centimetres |  |
| dim3 | dim3 | integer |  |  |  | dimension 3 in centimetres |  |
| actmass | actmass | float |  |  | M | mass in kilograms |  |
| item | item | integer |  |  | M | start from 1, per array entry |  |
| defitem | defitem | integer |  |  |  | default content item unique code |  |
| submitCollection Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | string |  |  |  | The error message if errorcode is a non-zero value |  |
| results | results | array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| submitCollection Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| waybillno | waybillno | string |  |  |  | generated waybill number |  |
| gentracking_retval | gentracking_retval | string |  |  |  | 1 = tracking numbers generated |  |
| collectno | collectno | integer |  |  |  | generated collection number |  |
| waybillBase64 | waybillBase64 | string |  |  |  | base64 encoded string for waybill pdf |  |
| labelsBase64 | labelsBase64 | string |  |  |  | base64 encoded string for labels pdf |  |
## Sheet: quoteToCollection
| quoteToCollection Request |  |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| quoteno | quoteno | string | [24] |  | M | quote number to be converted |  |  |
| waybillno | waybillno | string | [24] |  |  | waybill number to be generated |  |  |
| starttime | starttime | string | [8] | hh:mm:ss |  | start time for collection window |  |  |
| endtime | endtime | string | [8] | hh:mm:ss |  | end time for collection windows |  |  |
| quoteCollectionDate | quoteCollectionDate | string | [10] | dd.mm.yyyy |  | collection date |  |  |
| notes | notes | string | [150] |  |  | notes for this collection |  |  |
| specins | specins | string | [60] |  |  | special instructions |  |  |
| printWaybill | printWaybill | integer |  |  |  | 1 = return base64 encoded waybill pdf |  |  |
| printLabels | printLabels | integer |  |  |  | 1 = return base64 encoded labels pdf |  |  |
| ttype | ttype | string | [1] |  |  | transaction type, default = 'I' |  |  |
| quoteToCollection Response |  |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| errorcode | errorcode | integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |  |
| errormessage | errormessage | string |  |  |  | The error message if errorcode is a non-zero value |  |  |
| results | results | array | [..] |  |  | An array of results which will always have a single element if non-null |  |  |
| quoteToCollection Response[results] |  |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |  |
| collectno | collectno | integer |  |  |  | generated collection number |  |  |
| actkg | actkg | float |  |  |  | shipment actual weight |  |  |
| chargemass | chargemass | float |  |  |  | shipment chargeable weight |  |  |
| waybillBase64 | waybillBase64 | string |  |  |  | base64 encoded string for waybill pdf |  |  |
| labelsBase64 | labelsBase64 | string |  |  |  | base64 encoded string for labels pdf |  |  |
| waybillno | waybillno | string |  |  |  | generated waybill number |  |  |
| gentracking_retval | gentracking_retval | integer |  |  |  | 1 = tracking numbers generated |  |  |
## Sheet: submitCompoundCollection
| submitCompoundCollection Request |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| details | details | array | [..] |  | M | origin details for collection |  |
| waybills | waybill | array | [..] |  | M | array containing destination address per waybill |  |
| ttype | ttype | string | [1] |  |  | transaction type, default 'I' |  |
| submitCompoundCollection Request[details] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| i_collectno | collectno | integer |  |  |  | uniqu collect number, system generated. |  |
| accnum | accnum | string | [6] |  |  | customer account number |  |
| collectiondate | collectiondate | string | [10] | dd.mm.yyyy |  | date for collection |  |
| origpers | origpers | string | [60] |  |  | origin address name |  |
| origperadd1 | origperadd1 | string | [30] |  |  | origin address line 1 |  |
| origperadd2 | origperadd2 | string | [30] |  |  | origin address line 2 |  |
| origperadd3 | origperadd3 | string | [30] |  |  | origin address line 3 |  |
| origperadd4 | origperadd4 | string | [30] |  |  | origin address line 4 |  |
| origplace | origplace | integer |  |  |  | origin place code |  |
| origtown | origtown | string | [50] |  |  | origin town name |  |
| origperpcode | origperpcode | string | [10] |  |  | origin postal code |  |
| origpercontact | origpercontact | string | [30] |  |  | origin contact name |  |
| origperphone | origperphone | string | [30] |  |  | origin phone number |  |
| origperphone2 | origperphone2 | string | [30] |  |  | origin alternate phone number |  |
| origpercell | origpercell | string | [30] |  |  | origin cellphone number |  |
| origlatitude | origlatitude | float |  |  |  | origin latitude |  |
| origlongitude | origlongitude | float |  |  |  | origin longitude |  |
| duedate | duedate | string | [10] | dd.mm.yyyy |  | due date |  |
| starttime | starttime | string | [8] | hh:mm:ss |  | start time for collection window |  |
| endtime | endtime | string | [8] | hh:mm:ss |  | end time for collection window |  |
| notes | notes | string | [150] |  |  | collection notes |  |
| weight | weight | float |  |  |  | total weight being collected |  |
| pieces | pieces | integer |  |  |  | total box count being collected |  |
| submitCompoundCollection Request[waybills] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| details | details | array | [..] |  | M | Array of waybills being collected |  |
| contents | contents | array | [..] |  | M | Array of content information |  |
| wayrefs | wayrefs | array | [..] |  |  | Array of additional references |  |
| tracks | tracks | array | [..] |  |  | Array of tracking entries |  |
| submitCompoundCollection Request waybills[details] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| waybill          | waybill          | string | [24] |  |  | quote or waybill number |  |
| costcentre       | costcentre       | integer |  |  |  | customer costcentre |  |
| service          | service          | string | [3] |  |  | transport service |  |
| waydate          | waydate          | string | [10] | dd.mm.yyyy |  | waybill date |  |
| destpers         | destpers         | string | [35] |  |  | receiver name or consignee |  |
| destperadd1      | destperadd1      | string | [30] |  |  | receiver address line 1 |  |
| destperadd2      | destperadd2      | string | [30] |  |  | receiver address line 2 |  |
| destperadd3      | destperadd3      | string | [30] |  |  | receiver address line 3 |  |
| destperadd4      | destperadd4      | string | [30] |  |  | receiver address line 4 |  |
| destplace        | destplace        | integer |  |  |  | receiver place number |  |
| desttown         | desttown         | string | [50] |  |  | receiver town name |  |
| destperpcode     | destperpcode     | string | [8] |  |  | receiver postal code |  |
| destpercontact   | destpercontact   | string | [30] |  |  | receiver contact name |  |
| destperphone     | destperphone     | string | [20] |  |  | receiver phone 1 |  |
| destperphone2    | destperphone2    | string | [20] |  |  | receiver phone 2 |  |
| destpercell      | destpercell      | string | [20] |  |  | receivers mobile number |  |
| duedate          | duedate          | string | [10] | dd.mm.yyyy |  | waybill due date |  |
| specinstruction  | specinstruction  | string | [60] |  |  | special instruction |  |
| reference        | reference        | string | [15] |  |  | waybill reference number |  |
| insuranceflag    | insuranceflag    | integer |  |  |  | insurance flag |  |
| instype          | instype          | integer |  |  |  | insurance type |  |
| declaredvalue    | declaredvalue    | float |  |  |  | value of the freight for insurance |  |
| nondoxflag       | nondoxflag       | integer |  |  |  | not documents flag |  |
| currency         | currency         | float |  |  |  | transport cost currency |  |
| customsvalue     | customsvalue     | float |  |  |  | value of freight for customs |  |
| surchargeflag1   | surchargeflag1   | integer |  |  |  | surcharge flag 1 |  |
| surchargeflag2   | surchargeflag2   | integer |  |  |  | surcharge flag 2 |  |
| surchargeflag3   | surchargeflag3   | integer |  |  |  | surcharge flag 3 |  |
| surchargeflag4   | surchargeflag4   | integer |  |  |  | surcharge flag 4 |  |
| surchargeflag5   | surchargeflag5   | integer |  |  |  | surcharge flag 5 |  |
| surchargeflag6   | surchargeflag6   | integer |  |  |  | surcharge flag 6 |  |
| surchargeflag7   | surchargeflag7   | integer |  |  |  | surcharge flag 7 |  |
| surchargeflag8   | surchargeflag8   | integer |  |  |  | surcharge flag 8 |  |
| surchargeflag9   | surchargeflag9   | integer |  |  |  | surcharge flag 9 |  |
| pieces | pieces | integer |  |  |  | waybill total piece count |  |
| submitCompoundCollection Request waybills[contents] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| pieces | pieces | integer |  |  | M | number of pieces |  |
| description | description | string | [30] |  | M | freight description |  |
| dim1 | dim1 | integer |  |  |  | dimension 1 in centimetres |  |
| dim2 | dim2 | integer |  |  |  | dimension 2 in centimetres |  |
| dim3 | dim3 | integer |  |  |  | dimension 3 in centimetres |  |
| actmass | actmass | float |  |  | M | mass in kilograms |  |
| item | item | integer |  |  | M | start from 1, per array entry |  |
| defitem | defitem | integer |  |  |  | default content item unique code |  |
| submitCompoundCollection Request waybills[wayrefs] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_reference | reference | string | [15] |  | M | reference number |  |
| i_pageno | pageno | integer |  |  | M | set to 1. Increment for multiple instances of a reference number |  |
| submitCompoundCollection Request waybills[tracks] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| s_trackno | trackno | string | [28] |  | M | unique tracking number |  |
| i_parcelno | parcelno | integer |  |  | M | increment, start from 1 |  |
| i_item | item | integer |  |  |  | Required if linking tracking numbers to specific pieces in contents array |  |
| submitCompoundCollection Response |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| errorcode | errorcode | Integer |  |  |  | An integer errorcode. If 0 then there was no error else an error occurred |  |
| errormessage | errormessage | String | [500] |  |  | The error message if errorcode is a non-zero value |  |
| results | results | Array | [..] |  |  | An array of results which will always have a single element if non-null |  |
| submitCompoundCollection Response[results] |  |  |  |  |  |  |  |
| SOAP | JSON | Type | Length | Format | Mandatory | Description | Notes |
| gentracking_retval | gentracking_retval | integer |  |  |  | 1 = tracking numbers generated |  |
| collectno | collectno | integer |  |  |  | generated collection number |  |
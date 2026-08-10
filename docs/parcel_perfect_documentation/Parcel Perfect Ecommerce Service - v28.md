# Parcel Perfect Ecommerce Service v28

## Overview

ecomService is a web services interface between an ecommerce site and a Parcel Perfect environment. It facilitates requesting quotes for transport charges from the courier and submitting collection requests. All methods to achieve this are outlined below. 

## Environment

Methods are exposed via both REST-based Json and SOAP end points. Documentation and examples are provided for both. 

## Testing environment

You will need to obtain a test account from Parcel Perfect. Email support@parcelperfect.com with the subject: Request for ecom test account. Please provide your contact details and which courier / transport provider you are working with. 

On approval, you will be provided a username, password and account number. 

Documentation and examples 

You can find all supporting documentation and examples to run in the test environment at http://adpdemo.pperfect.com/ecomService/v17/downloads/ 

End Point URLs 

<table><tr><td>Type</td><td>URL</td></tr><tr><td>Json end point</td><td>http://adpdemo.pperfect.com/ecomService/v28/Json/</td></tr><tr><td>SOAP end point</td><td>http://adpdemo.pperfect.com/ecomService/v28/Soap/</td></tr><tr><td>SOAP WSDL</td><td>http://adpdemo.pperfect.com/ecomService/v28/Soap/index.php?wsdl</td></tr></table>

## Authentication


Methods – Full API Specification at end of document


<table><tr><td>Method</td><td>Function</td></tr><tr><td>getSalt</td><td>On submitting the user name the method returns a salt value</td></tr><tr><td>getToken</td><td>On submitting the user name and encrypted password using the salt value and the user password, this method passes back a token</td></tr><tr><td>expireToken</td><td>Calling this method invalidates the existing token</td></tr></table>

In order to use the web-services, one must first authenticate by getting a security token. All methods within the Ecommerce Webservice other than the Auth class require the token to be submitted with the request. 

With your username and password, first get a salt from the end point URL. Encrypt the salt with MD5 and use your username and encrypted password to get a token. 

The token is valid until you call the expireToken or getSalt methods. 

Authentication method flow 

![](images/02e9d581233c8ca806d8a23f0449131edc01721fbe9faa94e987796f7c6b86d3.jpg)


1) Make a call to getSalt with your username (email address) 

2) The response will include a salt 

3) Concatenate the password and the salt and create an md5 hash: md5(password+salt) 

4) Call getSecureToken using the md5 hash create in 3) above as your password 

5) The response will include the token to be used with subsequent requests 

Tokens do not expire and will remain active as long as required. Should your token expire and a new one is requested we will simply re-enable the original token. 

sss 

## Getting a quote from ecomService


Class – Waybill


<table><tr><td>Method</td><td>Function</td></tr><tr><td>getSingleWaybill</td><td>Returns full waybills details for the submitted waybill number.</td></tr></table>


Class – Quote


<table><tr><td>Method</td><td>Function</td></tr><tr><td>requestQuote</td><td>Requests a quote using submitted details. Returns costs based on a service level.</td></tr><tr><td>updateService</td><td>Sets the service of an existing quote, preparing it for conversion.</td></tr><tr><td>quoteToWaybill</td><td>Converts a quote into a waybill.</td></tr><tr><td>getPlacesByName</td><td>Returns a list of places based on a partial name lookup.</td></tr><tr><td>getPlacesByPostcode</td><td>Returns a list of places based on a postal code lookup.</td></tr><tr><td>getDefItems</td><td>Returns a list of default content items.</td></tr></table>


Class – Collection


<table><tr><td>Method</td><td>Function</td></tr><tr><td>submitCollection</td><td>Submits through a collection request to the courier.</td></tr><tr><td>quoteToCollection</td><td>Converts a quote to a collection with associated waybill number.</td></tr><tr><td>submitCompoundCollection</td><td>Submits through a bulk collection with multiple waybills and destinations attached.</td></tr></table>

An excel document accompanies this document that includes a breakdown for each method and its fields. 

Before submitting a requestQuote, you will need to obtain the originating and destination place value via getPlacesByName or getPlacesByPostcode. The place value selected from either of these two functions will be used in the requestQuote method. In the case where the originating place is constant, the place value can be pre-determined and is not necessary to call these methods. 

Along with the places, at least one entry in the requestQuote.contents array must be submitted. This is the minimum amount of freight that can be transported. The requestQuote method returns an array of possible transport costs against each service available. If only one service is available, then it is unnecessary to call the updateService method. If there is more than one service available, call the updateService method to update the quote with the user selected service. 


Request quote method flow


![](images/d95ba613904d25c40dbb5398c8b06583c00983a207fc272c4c4d1c2a55758b54.jpg)

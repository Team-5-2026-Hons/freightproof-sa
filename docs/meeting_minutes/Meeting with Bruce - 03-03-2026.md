# Meeting with Bruce - 03/03/2026

Attendees: Tim Gultig, Ciaran Formby, Bruce van Wyk, Chiko Kasongo, Thomas Davis 

## Overview

The meeting focused on advancing a digital cargo tracking and driver management solution for the logistics industry. Participants discussed integrating systems to secure a digital chain-of-custody using solutions like Pulse Tracking and API connections, while addressing challenges such as manual verifi cations and theft risks. 

## Key Takeaways

The team agreed to implement a digital system that requires scanned identifi cation to ensure only authorized driver–truck–load pairings initiate a journey. 

They decided to conduct a pilot test on a specifi c route (Joburg to Durban) using Pulse Tracking for realtime monitoring. 

It was agreed that Tim would send all team members’ scanned IDs in one consolidated email to Bruce, who will then provide the necessary operational links and credentials. 

Discussions also covered integrating various data sources through APIs and evaluating the feasibility of replacing traditional barcoded labels with NFC/RFID tags for automated parcel tracking. 

The meeting highlighted the need for a driver interface that minimizes distractions, weighing options between a dedicated app and a WhatsApp-based solution. 

## Next Steps

Tim Gultig: Send a consolidated email with scanned copies of all team members' IDs to Bruce. 

Bruce van Wyk: Provide operational links, usernames, and passwords for real-time tracking on the designated route. 

To be Assigned: Coordinate and conduct a live trial run on the Joburg to Durban route using a single truck and driver. 

To be Assigned: Research the cost and feasibility of adopting NFC/RFID tags for automated parcel tracking versus traditional barcode methods. 

To be Assigned: Investigate reliable external sources for logistics crime and theft statistics to support market analysis. 

To be Assigned: Continue discussions on API integration protocols to ensure secure and unifi ed data exchange across systems. 

## Key Topics

## Project Overview and Branding Discussion

Bruce introduced the concept of naming the solution with various acronyms (e.g., TCT Tango, Charlie Tango, etc.) to potentially create a valuable brand for investors and individual recognition. 

The discussion set the context for developing a digital cargo tracking and driver management solution that would integrate multiple functionalities. 

## Digital Chain-of-Custody and Tracking System Idea

Tim summarized the need for a digital system that replaces easily forged paper delivery notes with a digitally signed, immutable chain-of-custody, using blockchain and secure driver-truck-load binding. 

The solution was discussed to include GPS tracking checkpoints, an audit trail, and potentially integration with technologies like Bluetooth and NFC for remote zones. 

## Protocol and Onboarding Requirements Decision

Bruce outlined the protocol that required team members to send copies of their IDs via email so that he could set up links, usernames, and passwords for real-time tracking access. 

It was decided to start testing with a controlled setup involving a single route, truck, and driver. 

## Routing and Operational Details Decision

The team agreed to test the system on a route from Johannesburg to Durban, which typically takes about 7 to 8 hours, with defi nite departure and arrival time windows. 

Bruce provided details on how real-time data would be captured, including camera footage and vehicle checkpoints along the route. 

## Integration with Existing Systems and APIs Update

Bruce emphasized the use of the Pulse Tracking system for integrated tracking and confi rmed that the system would leverage APIs (REST, SOAP, AI APIs) to collate data from multiple sources. 

Discussions included integrating with of -the-shelf solutions like Parcel Perfect, with potential API testing and security validations from partners (e.g., Menzies Aviation). 

## Driver Interface and User Experience Considerations Idea

Tim and Bruce discussed the pros and cons of deploying a dedicated app versus using an interface like WhatsApp for driver communication. 

They emphasized that the communication interface must minimize distractions for drivers, allowing only impactful notifi cations to ensure driver focus on critical tasks. 

## Driver Performance Tracking and Incentives Update

The discussion covered tracking driver performance via systems like Pulse Tracking, with Bruce mentioning a rewards mechanism from his experience in cargo airline rewards. 

It was noted that monitoring driver performance can reduce insurance premiums by linking bonus schemes and performance metrics with risk reduction. 

## Advanced Parcel Tagging Technologies Idea

Tim raised the possibility of using NFC/RFID tags to automate parcel tracking, thereby eliminating manual scanning and reducing human errors. 

Bruce highlighted that further research on the cost comparison between traditional barcodes and new automated tagging systems would be necessary. 

## Risk Management for Ad Hoc vs. Contract Deliveries Update

The meeting discussed the dif erences in risk between ad hoc and contract-based deliveries, including verifi cation measures such as upfront payments and temporary driver IDs for subcontracted drivers. 

Bruce explained that while ad hoc loads of er higher yield, they require robust verifi cation to mitigate risk, and suggested increasing the pool of trusted drivers as a preventative measure. 

## Market Data and Crime Statistics in Logistics Update

Tim inquired about reliable sources for crime and theft statistics in the logistics industry, highlighting the need for accurate fi gures to support market analysis. 

Bruce advised reviewing data from tracking companies and industry claims, while noting fi gures such as the South African Insurance Crime Bureau's estimate on hijacking costs, and emphasized the need to corroborate market statistics. 

The discussion underscored the importance of these statistics in building a strong business case for the digital tracking solution. 

## Next Steps and Action Items Decision

Tim committed to sending a consolidated email with scanned copies of team member IDs to Bruce. 

Bruce planned to provide the necessary links, passwords, and usernames to access a test truck’s tracking data on a designated route. 

The team agreed to conduct further research on automated tagging technologies (NFC/RFID) and to investigate reliable sources for market statistics on logistics crime. 

## Transcript

Tim Gultig: At this hour of the night? 

Thomas Davis: Hachiko. To me. Yeah, yeah. Are you going to the library of this? 

Tim Gultig: Yeah. 

Thomas Davis: Why? 

Tim Gultig: I need to because I don't work at digs. I just go and play fortnite and six sevens on the couch playing cricket and it's kind of hard to work 

Thomas Davis: my boy Ronaldo, he's 

Tim Gultig: got his meeting over 

Ciaran Formby: my presentation at three and then I might come to the library. Three 

Thomas Davis: o'. Clock. That's in like three hours, bro. But 

Ciaran Formby: I'm not gonna go there and back because Sony like understand stuf . What 

Thomas Davis: are you gonna do? Are you gonna practice for three hours? No, Ciaran Formby: Dave, I'm gonna do some of my literature review in between and then I'm gonna. Tim Gultig: Dave, you muted, bro. Dave, you muted. Ciaran Formby: Tell me muted, but. You're making me scared. Changing the design. Tim Gultig: Forefront of the meeting, Thomas Davis: Even on. What is 670 doing these days? Tim Gultig: Playing fortnite, bro. Like, Thomas Davis: is that all he does all day? Tim Gultig: He goes in place? How's Thomas Davis: it, Bruce? Bruce van Wyk: How's Ciaran Formby: it Bruce? How are you? Good Bruce van Wyk: morning. Good morning, James. Sorry I'm a bit late. Morning, Tim Gultig: Bruce. No worries. How Bruce van Wyk: are you guys? Tim Gultig: Yes. Since Bruce van Wyk: the last time I've seen you. Ciaran Formby: Yeah. Bruce van Wyk: Are you late as well? Yeah, Ciaran Formby: all Tim Gultig: good, Bruce van Wyk: good, good. All right, so a couple of things. Did you guys work on my quiz? Ciaran Formby: Yeah, I gave, gave a couple a try, Bruce van Wyk: but Ciaran Formby: yeah, two of them I couldn't, I couldn't get. Okay, Bruce van Wyk: well, it's a combination. Let me quickly tell you. It's a combination of obviously your names, but I think it's important just from a, from a point of view that it could become a brand which may become valuable for investors and for, for you as, as individuals. Hold on for me one sec. Ciaran Formby: All Bruce van Wyk: right, so who, who's joining us on the call today? Tim Gultig: It's our fourth group member and then that's just an AI note taker, but his camera and my aren't working. Al Bruce van Wyk: right, I'm not going to do the camera. I think with what's going on in the world, Starlink's not operational. Ciaran Formby: Okay. 

Bruce van Wyk: All right, so just to come back, TCT Tango, Charlie Tango stands for Transform Cargo Tracking Sierra. Charlie Tango starts stands for Smart Cargo Tracking Golf Sierra Delta Golf Charlie Delta stands for Geocargo Designs. Charlie Delta Golf stands for Cargo Design Group and so on and so forth. So yeah, just let's put a name to it, whatever you guys decide. And we, we then start packaging. Okay, 

Ciaran Formby: cool. I had a couple mine away of that so I didn't, I didn't get cool 

Bruce van Wyk: voice. So all right, so from, from a tracking and visibility perspective today, what are your expectations here? 

Tim Gultig: Probably just to see how a simple process goes because 

## Bruce van Wyk: we

Tim Gultig: can almost. Then like once you've, you've seen how like a track, when you track something, you kind of get to see the full picture, if you know what I'm saying. We get to see where we can add value and also where, where there is issues, etc. I think, yes, 

## Bruce van Wyk: that's

Tim Gultig: one of our main things also just to understand because 

## Bruce van Wyk: you

Tim Gultig: can't build something for something you don't understand. Yeah, yeah, 

Bruce van Wyk: for sure. All right, so from a protocol perspective, guys, what I need is your copy of your id. If you can mail it to me, if it's going to be all of you, please provide me with your, your ID copies. What I will then in turn do is I will set you up with links, passwords and usernames and you can all at dif erent times go and view where the truck is. Depending on where the truck is, you will be able to view camera footage and so on. Basically on the nose of the vehicle, the tank and the back. 

Tim Gultig: Okay, that sounds perfect. Yeah, we'll probably. I'll send them in one email so you don't have to have fi ve emails. I'll send all the documents in one now. All 

Bruce van Wyk: good. So I think that from that perspective we'll, we generally depart and I'll hook you up with a small route. Not a small route, but distance wise, a Joburg Durban or a Durban Java Groot. 

## Tim Gultig: Perfect.

Bruce van Wyk: That generally takes about seven to eight hours depending on the departure time, what the mass is, how many way bridges we have to go past and you know, all the, all the things that you will encounter if you're a truck driver. Perfect. 

Tim Gultig: Sounds good. Who 

Ciaran Formby: can. Bruce, what system do you use? What's the system that we'll be logging on to view all of this? 

Bruce van Wyk: So I've checked it. The best solution for me as I stand here would be to introduce you to pulse tracking. Remember we spoke about the geofencing. If you compare that to car track or matrix or whatever platform you do, it's more of a holistic and integrated system because it works on more than a car track would do. Geofencing, gp, GSM and so on. 

## Ciaran Formby: Cool.

Tim Gultig: And then just so we can make sure we're on the same page with the project, etc. Yeah, 

Bruce van Wyk: yeah. 

Tim Gultig: So would you say, if I was to say this is essentially what we understand, is that the industry, as I'm just going to use you as an example, would require a Move away from easily forged paper delivery notes and manual trust caps towards a more digitally signed immutable chain of custody layer which is obviously secured using blockchain as a digital vault. So we are essentially going to bind a specifi c driver to a specifi c truck with a specifi c load into a single digital lock. This, this can't be changed or faked once a journey begins. So this is ensuring that only the authorized truck driver pairing or the, the authorized driver plus truck plus pickup point 

## Bruce van Wyk: is

Tim Gultig: the only thing that can execute to pick up which provides essentially 100 proof of who had the goods at, at every stage of the journey. And then 

## Bruce van Wyk: along

Tim Gultig: with that will come GPS tracking checkpoints. And then we had a meeting. Obviously there's going to be an audit trail and then in remote zones we can have Bluetooth handshakes or NFC use NFC technology. Then we had a meeting with a guy who's an academic in the logistics sector and he said to us that we must look into because obviously reducing insurance costs will also, I mean if you 

## Bruce van Wyk: can

Tim Gultig: reduce the driver being tired, you can essentially that speaks to an insurance cost because obviously accidents might often happen when a driver is tired or when he's been working too many hours. So this guy said if we can fi nd a way to introduce into our system for long distance trucking, is there a way we could integrate a system whereby the app obviously rewards drivers? So drivers get a user profi le and they get rewarded for so almost like a discovery but for drivers. 

## Bruce van Wyk: So

Tim Gultig: they get good driving and they get like say they've been driving for 10 hours, it forces them to take that break and it checks that their GPS is in the geofenced stop zone which is 

## Bruce van Wyk: pre

Tim Gultig: selected by the company and then they can keep going. So it's pretty much a reputation, a reputation score of the driver and, and I mean even like guards can get the reputation score for scannings on time or shifts and obviously that's way later down the line. But I mean pretty much a more integrated system where it's going to include the driver as well as part of the system. Do you think that's something that you would look into as well? 

Bruce van Wyk: Well, yeah, and jog your memory. One of the key areas that I tabled was exactly. Insurance is depicted in price by the performance of a particular driver or a route or whatever. And there are many conditions that the insurance houses of set against the risk component. So 

## Tim Gultig: we

Bruce van Wyk: can track through and that's unfortunately not for today, but we can track exactly the performance of any particular driver. Now you'd be happy to know That I designed a rewards company for a cargo airline called Bidet Cargo. So the, the same dynamic holds true. The performance per parcel in this case is measured by compliances. The same will happen with, with a driver. If you run for a month, you get let's say a rand per kilometer. Now these, these things matter because the insurance company now will decrease your premium. You will upscale your loyalty and your diligence of your drivers. So the unity of all that considered is very important. Yeah, 

Tim Gultig: sure. Makes sense. 

Ciaran Formby: Also with, with that, that you mentioned, you kind of have a way of measuring kind of the driver's risk and whatnot. What. 

Bruce van Wyk: Yeah. 

Ciaran Formby: What is that currently done on like what do you use to do that now? Is it your in house build system? Is it part of Pulse it? 

Bruce van Wyk: No. So we, we use dif erent systems. So let's talk about pulseit. We can drill down Tim Gultig: into. 

Bruce van Wyk: We assign a vehicle to a driver for this month as an example. So our driver vela would, would drive Marco 01. Right. The performance of Vela is then given to us through the data history of that particular route truck driver on a monthly basis. And we usually then give him a bonus every three months, every quarter. But that's a, that's a management function. 

Ciaran Formby: Whereas 

Bruce van Wyk: your application could very well be in the pocket of the driver, you know, so instead of rewarding and motivating him every three months, it's now live, you know, it makes a huge dif erence. 

Tim Gultig: Yeah, that's true. Then we were looking into obviously because we're going to have your, your front end of how the driver users interacts with the application, your middle which is going to be people sitting in the company and then obviously the back end won't be seen by anyone. So I was just wondering because we were having a conversation around what's the best way to interact with the driver. So there is means it is quite complicated to set up. But do you think a driver would be more willing to use the front end of it if it wasn't an application? But if you interacted via WhatsApp, would you say that would be something that you would more likely buy into? Because we were just wondering obviously a lot of people do use WhatsApp and it'll be cool if they could interact with the system inside of WhatsApp. Obviously we still will have an app because the tracking, et cetera. But I mean just out of research purposes, 

Bruce van Wyk: would 

Tim Gultig: you say that 

Bruce van Wyk: WhatsApp 

Tim Gultig: is a. 

Bruce van Wyk: Yeah, yeah. Look, 

Tim Gultig: WhatsApp 

Bruce van Wyk: is, is a great platform. Right. But our responsibility with that interface with the driver, you don't want a driver traveling with 8 tons of freight on his ass to be bothered by looking at his phone all now and again. So the parameters needs to be very clear and set so you can design the fact that driver Vela will stop at for innocent or he will stop at Harry Smith and then the updates will come. What would be interesting if the system like Pulse it currently does is give alerts to the control center, as it were. But we try and minimize the constant calling or whatsapping with a driver because we've got visibility where he is, how fast he's driving, what driving, what the braking conformances are. So it boils down to getting the driver to concentrate on the job at hand. Okay, 

Tim Gultig: so like an interface where you can correct. Interact with where there's no distractions almost. Because obviously when you're going onto WhatsApp you might see other chats, etc. Whereas if you're coming into this app that we build, you're saying that it would be easier for him because now he's less distractions and it's just focus on the job at hand. Yeah, 

Bruce van Wyk: exactly. So defi ne your communication and make it impactful. So instead of over communicating, make it more impactful because the driver needs to concentrate with the road conditions with. I mean it's, it's, it's crazy out there. 

Tim Gultig: Yeah. And then. Yeah, just another question in terms of routing etc with, with parcels and packaging. One one technology which we, we spoke to a bunch of. Well, we spoke to a guy from i2. He's, 

## Bruce van Wyk: he's a

Tim Gultig: software lead there. He was saying to us that there's a lot of. Obviously we, we were mentioning about the driver checking in and parcel tracking going onto the truck. Would NFC or RFID tags be adopted in the industry? Like I know some people already use it, but do you foresee, would you foresee that kind of a technology where if I have a parcel, on the parcel there's a little tag and then as soon as it passes into the truck it automatically gets tagged. As in the truck. No scanning. It's a system which can't be broken. So it's, it's not. Oh, I'm the driver, I forgot to scan. Sorry. It's, 

## Bruce van Wyk: it's

Tim Gultig: left the truck. We can see what exact what time it's left the truck. I mean that, that's a system that can't be switched of because obviously cameras you can just switch of , but an NFC scanner, RFID you can't. No. 

Bruce van Wyk: 100%. The, the question that we will have to broach at the time is currently a label. A barcoded label as a, as a dumb ex is placed on the box. So yes, there's a manual interface where the scanner, the loader of the vehicle scans the parcel into the truck. Right. What you're suggesting is that this is completely automated. There's a tag instead of a label. So my, my question to you would be investigate the cost of the, of the label versus this new gen application or. Or tag as you call it. Yeah, 

Tim Gultig: that makes that, that would be the, the biggest play would be the cost. You 

## Bruce van Wyk: have

Tim Gultig: to, we'd have to do some research into that. But yeah, I think it's maybe obviously we, we could later down the line decide how to implement it. But I mean 

## Bruce van Wyk: it

Tim Gultig: would also help because. Because then you can almost as me as the user say I've ordered something from somewhere and I'm waiting for this parcel to arrive. You can almost because obviously you don't want the user to be able to track where the truck is. There's a reason that doesn't happen 

## Bruce van Wyk: because

Tim Gultig: they could just go and hit the truck 

## Bruce van Wyk: but if

Tim Gultig: they could just see that their parcel is still in the truck, maybe that's also like a, in transit. But also because I know like a lot of places will say yeah, the take a lot van says I'm gonna arrive between 11 and 5pm it's like well I have a 

## Bruce van Wyk: day,

Tim Gultig: you know. Yes, 

## Bruce van Wyk: it'll

Tim Gultig: be quite cool if our system could even for business to business. I mean it would still be huge for them to say cool he has a half an hour window 

## Bruce van Wyk: because

Tim Gultig: now you can, you can shorten the window because I mean you'd probably have to make it an hour window because there's obviously trafi c and a bunch of things that could go wrong. But I mean would you say that that kind of a, an implementation would be useful in this, in this or it hasn't been used before because I know for me that's defi nitely a pain point as a user is. Is your parcel arrive in a 10 hour period? It's like well thanks, 

## Bruce van Wyk: I don't

Tim Gultig: know when I'm going to be 

Bruce van Wyk: here. Yeah, 100%. So it's in your comparison it's pick and pay or 6060 versus take a lot. Right. And it's true, it's true. The more defi ned you can give the window of delivery or collection, the better the customer feels. And it may be an hour but let's cut it down from fi ve hours or 10 hours to two hours. We've already achieved a hell Of a advantage. 

Tim Gultig: Yeah, exactly. And I mean I think that is a big thing with, with bigger shipping companies and logistics. I mean 60, 60 is, is, is an hour period. But then I think it's. Yeah, it's all your like your take a lot. Even if you order from like directly from Samsung and there's a bunch of places they never have a period a window. It's like it will be delivered tomorrow. Yeah, 

Bruce van Wyk: exactly. So I think the advantage of, of what we are talking about is exactly that. Mr. Take a. To give you a solution to take your 10 hour window down to a 2 hour window from a commercial impact point of view, the more orders will come because people aren't tied to your 10 hour cuck schedule. 

## Tim Gultig: Yeah, exactly. Okay, that makes sense

Ciaran Formby: Bruce, just with the ad hoc kind of customers that you mentioned in the last meeting and how a risk on your side is if a fake customer requests a truck or a consignment or something like that. What are the processes you currently have in like one vetting a customer? If there even is any kind of sort of verifi cation to kind of prevent this or how could we kind of help solve that problem of the ad hoc kind of theft? 

Bruce van Wyk: Yeah, so my thought on that Karen is that you know, upfront payment for an ad hoc load balances the risk scale. So a customer who pays you up front for that adult load is less likely to be wanting to steal your truck. However the driver may be includes with X, Y and Z and you know, 1.7 million rand 4 tanner, you've paid 20 grand to get the load down to Durban. So you know the economies of scale would answer you. So can one get rid of it entirely? I don't think so. But can we hone it down into a more palatable risk portfolio? For sure. 

Ciaran Formby: Okay. And then. So could that be solved by kind of using like having a pre verifi cation like code that's sent to the customer or that they have to verify with the driver to kind of like release the delivery or is that kind of not really solving the problem? 

Bruce van Wyk: Yeah, it, it's, it does solve part of the problem. So it depends when that interface starts. So Customer A orders an 8 tunnel from LFG before that truck leaves my yard. Well then I have to have that handshake. So let the, let the triggers be fl exible but let it address the risk in area, in time frame and all of those good things. Okay, 

Ciaran Formby: makes sense. 

Tim Gultig: Tom, you can go. 

Thomas Davis: I was going to ask Bruce what like percentage or not percentage. How many ad hoc deliveries do you have compared to Your normal like three year contract customers. All 

Bruce van Wyk: right, so let me do do two things for you, Tom. Firstly, on a macro scale, right, South African landscape. So the percentage from a South African landscape, ad hoc movement versus contractual work sits at about 40, 60. That, that number one in terms of LFG, we try and chase the contract work. It's stable, although it's less yielding than adult work. We try and go to trusted companies like FedEx or RTT or whoever. So although it's part of our portfolio, we don't actively go out and sell that. If a customer of RTT contacts us through their sales agent and say we need a abnormal load done, yes, we've got the mechanisms to supply that. But the yield then exponentially grows because it's not consistent. So from a load factor perspective, I'll say about 50% of turnover, 15% of turnover goes ad hoc, much higher yielding. But contract work is our bread and butter. Okay. 

Tim Gultig: It's obviously with ad hoc. Do you have a lot of spot market drivers where you know it's, he doesn't work for you just. 

Bruce van Wyk: No, 

Tim Gultig: not 

Bruce van Wyk: at 

Tim Gultig: all. 

Bruce van Wyk: No. 

Tim Gultig: Even if a, if a truck breaks down, it's, it's always your trusted drivers. 

Bruce van Wyk: Yeah. So if, so if I have to subcontract, let's say I don't have a 18 meter taut line in Cape Town and I have to subcontract that I have a standing running contract with supplier a subcontracted supplier a that supplies me this vehicle. So he has to produce for me a certain amount of security like driver details, tracking, access vehicle rage, all those good things. I will then do the routing order or the purchase order with him and everybody is on board. But we know those drivers, if that answers your question, Tim. 

Tim Gultig: Yeah, because all I was thinking is obviously we issuing a driver ID in our system and I mean if it's a contracted driver, we could obviously, if it's a subcontractor driver, you could 

Bruce van Wyk: essentially 

Tim Gultig: issue him a temp driver ID that expires. So if you have to get the subcontractor person out and he's not part of your, your let's say, group of drivers that you've already trusted and verifi ed, you're gonna link to the subcontractor and he's going to be issued a temporary driver ID. Obviously these driver IDs are digital because that's just, that is an issue that would have to look into is you would be getting some drivers that won't have the app installed yet. But I mean you can prerequisite and just say if you want to drive this truck, you're going to have to have this app installed. And I mean it's. The app won't exactly be the heaviest app to download because there's not going to be much like onboard things happening because it's a lot of. It's going to be cloud based. So yeah, I think that will, will defi nitely will help. So 

Bruce van Wyk: following 

Tim Gultig: on to 

Bruce van Wyk: that. Sorry, Tim, let me just stand still there 

Tim Gultig: with you 

Bruce van Wyk: a little minute. We just spoke about 10 hour delivery time frames versus an hour. Right. So the exact same holds true in this verifi cation process. When you have a unknown driver and you have to verify by design. You are saying that that verifi cation may take fi ve hours because we are South African. Right. And it delays the departure or deployment of that vehicle. So for, for us as LFG and maybe for you, something for you to consider is rather increase the pool of drivers from the onset than to go and verify them on the spot. 

Tim Gultig: Okay. Makes a lot of sense. Yeah. Yeah. So following on from that essentially as well, say, do. Do you have cases where your trucks break down? I'm sure you do. Oh, 

Bruce van Wyk: hell no. We drive Ferraris, Bruce. 

Tim Gultig: Yeah, 

Bruce van Wyk: yeah, no, they 

Tim Gultig: do, of 

Bruce van Wyk: course. 

Tim Gultig: So that's okay. So now if, if a truck breaks down, obviously. And now that's a load where you know, say it's like a 2 million rand load. 

Bruce van Wyk: Do you. 

Tim Gultig: Is your fi rst point of call to send a security company to the truck if it's in an area which you would be worried about the load? Yeah. 

Bruce van Wyk: Wherever that truck breaks down, we deploy a rescue. Right. So that may include, if it's a hijack situation, that will include an aligned company that we are contracting. For instance, Hawkeye or whoever. They will deploy based on the risk, either things like a helicopter, ambulance or tow vehicle. So if the truck merely breaks down, we assess through the driver who literally owns that asset. He knows it like he knows his baby. Right. So he will tell you, listen, the cam belt has gone. And then we will know what, who and what to trigger. So whether it's a roadside fi xable problem or do we deploy a towing vehicle big enough to tow the vehicle to the closest point, a man truck center as an example, and then fi x the vehicle together with how do we recover that freight? If the truck is now completely blown a motor, how do we recover that freight to customer? So those are the triggers that will guide us in our response. Okay, 

Tim Gultig: I see. 

Ciaran Formby: And then Bruce, 

Tim Gultig: I 

Ciaran Formby: remember you mentioned so parcel. Perfect. Yes. 

Bruce van Wyk: Last 

Ciaran Formby: time. What did. What do you use that and kind of yeah. Is it important for us to kind of pay attention to that or not really? 

Bruce van Wyk: Yeah. Kieran. Yeah, it is. So you get of the shelf packages, Parcel Perfect being one of them. So in South Africa, these, let's say 100 courier companies, most of them use the of the shelf product, which means that you go into as a customer, you go into the portal, you do a quote, you do a order and you confi rm depending on the service type, air freight, road freight and that's further divisible by product types within the service that will then trigger the driver a with a one tonne bucky to come and pick up your perishable item or whatever it is. So that is Parcel Perfect is a simple enough system for you to get your teeth into and know what the fi rst to last mile interface is. I'm very happy to share with you some fl ow charts and things like that. We busy with an API integration with Menzies Aviation. So it talks to our current conversation. Okay, 

Ciaran Formby: cool. And then just in terms of that, for our application that we end up building, I'm assuming it would need to pull data from kind of all the dif erent systems like pulses. Maybe Parce Perfect and then any other kind of systems that feed valuable data into, into this kind of evidence trail. Are there, do you know if there's kind of available APIs? Do we have to kind of go through you as, as load factor or do we go straight to them to get APIs? Yeah. What, 

## Bruce van Wyk: how does

## Ciaran Formby: that work?

Bruce van Wyk: Valid question. So yeah, of course there's obviously APIs and I can talk to that at nauseam. But let me break it down for you. Firstly there's rest APIs, there's soap APIs and the latest thing is AI API and it really has to do with the secure environment of exchanging these data forms. So you have customer, supplier and you and end user. Right. So if you want to bring all of those together into a one page snapshot, snapshot report, for instance, you will have to give your API to those people, they will test it and then they will say shop. Karen, you are good to go. All the security principles have been met and the systems talk to one another. So to give you a very condensed view on that. Okay. 

Ciaran Formby: So you kind of have to approach them with your API that you've created and they will verify whether that works or not. 

Bruce van Wyk: Yeah. So let me use a case in point. AMI is a multifaceted business, but in terms of this integration, they have got a product internationally called Click to Ship. Right. So you sitting in Shenzhou or wherever you Click on this portal and it then sends an order to me. I then do this. The logistics fulfi llment from Hong Kong to Joburg and the end last mile delivery. I've had to issue them my APIs. They do then the testing. They ask a ton of questions and eventually the software developers, they interface the two. So it's not a major hurdle. I don't want you to be, to be negative about that. It's actually very exciting. So I've got proven ongoing studies that, that talks about this. Always fi nding new ideas because people protect. Okay, 

Ciaran Formby: cool. That's. That's interesting to know. 

Tim Gultig: Perfect. Yeah. Just another question from my side. So we were asked to do some research into crime and theft and logistics just to see like what our market cap, what our market size is going to be. Do you know of any? Because obviously we can search but to fi nd reliable information is quite difi cult for, for actual, for actual numbers. Do you know of any sources, databases, police databases where we can actually get real fi gures? Because I mean we've got here like we can see that the, the market size of logistics is 435 billion. I think that was in 2024. And we can see that 56% of commercial vehicles are likely to experience crime over private vehicles and they're twice as violently hijacked. So we've got a bunch of information here, but what we would like to see is just like straight numbers, like 42% of cargo trucks 

valued at 6.2 billion rand was stolen in 2025. Like that kind of information. Do you know a place where we can get those numbers? Yeah. 

Bruce van Wyk: So I think you can, you can learn a little bit from normal websites like car track, those kind of people who are very proud to announce to you that because of my system only 5% of my vehicles get stolen. It's the fact of the matter is that look at it from a micro dynamic and a macro dynamic. So I can give you real numbers from a load factor and the little bit of market share that I do control. I can give you the statistics that will tell you I've got nothing to hide. I actually, actually admit to us being a country of violence. But that will be factual. But it will exclude the 485 billion rand. That is true to a point in your study. So, but go to the car tracks and go to various of these particularly tracking companies to start your, your, your answer because, 

Tim Gultig: because the South African Insurance Crime Bureau claim that 3 billion rand a year in hijacking costs to the economy. Would you say it's hard to tell but would you say that that number sounds about correct? Because we just needed 

Bruce van Wyk: to verify. 

Tim Gultig: Obviously we can verify the source, but like they could be making 

## Bruce van Wyk: a

Tim Gultig: guk. 

Bruce van Wyk: Yeah, so. So I think it's like a frog swimming in cold water and you heat the pan. So it will die a beautiful death. Right. So take it at face value. And the deductions can be supported by companies like us, like RTT and so on. To give you a quick reference, RTT runs multi million rand company. Their success rates, it's at 82% service levels, taking into, and that's verbatim taking into account missed collections, missed deliveries, hijackings, breakdowns, all of those good things. I think the rule of thumb is about the 85%. That's real. FedEx will tell you. No, no, no, no, no. We operate at 99.275. It's. 

Tim Gultig: Okay. Yeah, so we was just taking that face value. I see. Yeah. 

Bruce van Wyk: So. So work from this point between 85 and to the max. 91. That's. That's real. It's 

Tim Gultig: okay. And then just because we were trying to obviously expand as well because we needed to. The. One of the. He's a guy from Mumbai. He, he essentially runs a sort of a software solution company. He was just asking us in terms of like, business value. He wants to see the, the dif erent sectors because obviously you've, you've got your, your, your trucking, your ships, your planes and your trains. Would you say the biggest issues with trucks? 

## Bruce van Wyk: Yeah,

Tim Gultig: yeah, 

Bruce van Wyk: absolutely. So shipping, the shipping has got international laws, maritime laws, the Jones law. It's complex. And for what we want to achieve right now, here together, let's exclude that. That's my advice. Right. When it comes to two real comparable transport modes in South Africa, you're talking about road and a. The, you know, transnet's nowhere close to giving a solution. And part of the mushroomed truck owners that do road freight is as a consequence of the inefi ciency. Right. So concentrate on air and concentrate on road. These two dif erent governing bodies, rules that apply to air and road. So to give you some guidance in that, let's talk a. When we talk a. Let's talk road. When we talk road. But he's quite correct. Two dif erent elements, speed, price and obedience, for lack of a better word. Okay, 

Tim Gultig: cool. That's pretty much it from my side, Tom. Kieran, do you have any more questions? Thomas Davis: I'm good. Ciaran Formby: I don't have any questions, Chico. Tim Gultig: I don't think his mic's working. Cool. So Bruce van Wyk: we're Tim Gultig: just going to send you our IDs and Bruce van Wyk: then 

Tim Gultig: you'll send us through the links, etc. So just a scanned copy of an ID? 

Bruce van Wyk: Yeah, that's it. And we, we, we give you the passwords, username and we'll concentrate on one route, one truck, one driver. So that it doesn't, you know, it, it's quite, it's quite nerve wracking to look at this landscape and go, we're for, I mean, my truck stuck. Okay, 

Tim Gultig: cool, perfect. I'll send 

Thomas Davis: this to you 

Tim Gultig: as soon as we can. 

Bruce van Wyk: Pleasure, boys. Lastly, from my point, our vehicles generally. I'll see which is the best spec. Our vehicles generally depart on Joburg, Durban around the 9 o' clock at night time, 9 to 10 depending on the customer. It then takes the journey to Durban. The truck arrives there between 5 and 7 o' clock in the morning. So you can do spot checks. Where's the struck at? Let's say 1 o' clock in the morning or 12 o'. Clock. But it will be an interesting viewpoint, it will answer potentially a lot of your questions. Yeah, Tim Gultig: for sure. Ciaran Formby: Thank you very Tim Gultig: much. That's Ciaran Formby: great. All Bruce van Wyk: right. Ciaran Formby: Is Bruce van Wyk: that it? Ciaran Formby: Yeah, I think that's all for me. Yes, Thomas Davis: thank you, Bruce van Wyk: Tom. Yeah, Tim Gultig: hopefully. Bruce van Wyk: Thanks Tim Gultig: so much, Bruce van Wyk: boys. All right, you're welcome. Ciaran Formby: Thanks a lot. 